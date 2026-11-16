const SESSION = 'witty-player-session-v2';
const $ = id => document.getElementById(id);
const read = (store,key) => {try{return window[store].getItem(key);}catch{return null;}};
const write = (store,key,value) => {
  try{if(value)window[store].setItem(key,value);else window[store].removeItem(key);}catch{}
};
function element(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if(className)el.className = className;
  return el;
}

let googleScript;
function loadGoogle() {
  if(window.google?.accounts?.id)return Promise.resolve(window.google.accounts.id);
  return googleScript ??= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const fail=()=>{
      clearTimeout(timer);
      script.remove();
      googleScript=null;
      reject(new Error('The Google sign-in button could not load.'));
    };
    const timer=setTimeout(fail,8000);
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.onload=()=>{
      if(!window.google?.accounts?.id){fail();return;}
      clearTimeout(timer);
      resolve(window.google.accounts.id);
    };
    script.onerror=fail;
    document.head.append(script);
  });
}

export function createPlayerHub(origin, onProfile, joinRoom, onSquad, rejoinSquad) {
  let session = read('localStorage',SESSION);
  let current = null;
  let section = 'profile';
  let activeRoom = null;
  let inboxTimer;
  let googleAttempt=0;
  let enrollment=null;
  let friendRequests=0, roomInvites=0;
  let squadState={party:null,invites:[]};
  let squadVersion=0, squadKey='', squadBusy=false;
  let lastFriends=[];
  write('localStorage','witty-player-session',null);
  write('sessionStorage','witty-pending-sign-in-key',null);
  const dialog = $('playerHub');
  const status = text => {$('hubStatus').textContent = text;};

  async function api(path, method = 'GET', body) {
    const headers = {};
    if(session)headers.Authorization = 'Bearer ' + session;
    if(body)headers['Content-Type'] = 'application/json';
    const response = await fetch(origin() + '/api/account/' + path, {
      method,headers,body:body?JSON.stringify(body):undefined,
      signal:AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(()=>({}));
    if(!response.ok){
      const error = new Error(data.error || 'The Player Hub is unavailable.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setProfile(profile) {
    current = profile;
    $('hubFriendsGuest').hidden = Boolean(profile);
    $('hubMember').hidden = $('hubFriendsMember').hidden = !profile;
    $('hubButtonLabel').textContent=profile?'@'+profile.handle:'SIGN IN';
    if(profile){
      $('hubPlayer').textContent=profile.name+' · @'+profile.handle;
      $('hubRename').elements.name.value=profile.name;
    }else{
      friendRequests=roomInvites=0;
      lastFriends=[];
      setSquad({party:null,invites:[]});
    }
    renderInboxCount();
    renderSignInOptions();
    onProfile(profile);
  }

  function renderSignInOptions() {
    $('hubGoogle').hidden=Boolean(current||enrollment);
    $('hubGoogleEnroll').hidden=!enrollment;
  }

  function renderInboxCount() {
    const count=friendRequests+roomInvites+squadState.invites.length;
    const badge=$('hubInboxCount');
    badge.hidden=!current||count===0;
    badge.textContent=count>99?'99+':String(count);
    $('openPlayerHub').setAttribute('aria-label',!current?'Sign in to Player Hub':
      count?`Open Player Hub, ${count} pending requests or invites`:'Open Player Hub');
  }

  function setSquad(data) {
    const key=JSON.stringify(data);
    if(key===squadKey)return;
    squadKey=key;
    squadState=data;
    renderInboxCount();
    renderSquad();
    if(section==='friends'&&!activeRoom)renderFriends(lastFriends);
    onSquad(data);
  }

  async function updateSquad(action,body={}) {
    if(!session)return null;
    const activeSession=session;
    const version=++squadVersion;
    const result=await api('squad',action?'POST':'GET',action?{action,...body}:undefined);
    if(session===activeSession&&version===squadVersion)setSquad(result);
    return result;
  }

  async function changeSquad(action,body) {
    if(squadBusy)return null;
    squadBusy=true;
    try{return await updateSquad(action,body);}
    finally{squadBusy=false;}
  }

  async function squadAction(action,body) {
    try{
      const result=await changeSquad(action,body);
      if(result)status('');
      return result;
    }catch(error){
      status(error.message);
    }
  }

  function squadButton(label,handler) {
    const button=element('button',label,'secondary');
    button.type='button';
    button.onclick=handler;
    return button;
  }

  function renderSquad() {
    $('squadGuest').hidden=Boolean(current);
    $('squadMember').hidden=!current;
    const {party,invites}=squadState;
    const me=party?.members.find(member=>member.handle===current?.handle);
    const leader=party?.leader===current?.handle;
    const connecting=party?.match&&!party.match.live;
    $('squadSummary').textContent=party
      ?connecting?'Connecting your squad…':leader?'Pick a Quick Play mode in the lobby. Queue when your squad is ready.':'Ready up when you’re in the lobby.'
      :'Create a squad or accept an invite from a friend.';
    $('squadInvites').replaceChildren(...invites.map(invite=>{
      const row=element('div','','hub-person');
      row.append(element('span',invite.name+' invited you to a squad','hub-name'),
        squadButton('Accept',()=>squadAction('accept',{squad:invite.squad})),
        squadButton('Decline',()=>squadAction('decline',{squad:invite.squad})));
      return row;
    }));
    $('squadRoster').replaceChildren(...(party?.members??[]).map(member=>
      element('div',`${member.name} · @${member.handle} · ${member.handle===party.leader?'Leader':member.ready?'Ready':'Not ready'}`,'hub-person')));
    const actions=$('squadActions');
    actions.replaceChildren();
    if(!party){
      actions.append(squadButton('Create squad',()=>squadAction('create')));
      return;
    }
    if(!connecting&&leader)actions.append(squadButton('Invite friends',()=>select('friends')));
    if(!connecting&&me&&!leader)actions.append(squadButton(me.ready?'Not ready':'Ready up',()=>squadAction('ready',{ready:!me.ready})));
    if(party.match?.canRejoin&&!$('lobby').hidden)actions.append(squadButton('Rejoin squad match',()=>rejoinSquad(party.match)));
    actions.append(squadButton('Leave squad',()=>squadAction('leave')));
  }

  async function pollSquad() {
    if(!session||squadBusy||($('lobby').hidden&&!dialog.open))return;
    const ready=squadState.party?.members.some(member=>member.handle===current?.handle&&member.ready);
    if(document.hidden&&!ready&&!squadState.party?.match)return;
    try{await updateSquad();}catch(error){if(error.status===401)endSession();}
  }

  async function prepareGoogle() {
    if(current||enrollment)return;
    const attempt=++googleAttempt;
    const active=()=>attempt===googleAttempt&&dialog.open&&section==='profile';
    const target=$('hubGoogleButton');
    target.replaceChildren();
    $('hubRetryGoogle').hidden=true;
    $('hubGoogleHelp').hidden=true;
    try{
      const {googleClientId}=await api('sign-in-options');
      if(!active())return;
      if(!googleClientId)throw new Error('Google sign-in is temporarily unavailable.');
      const activeSession=session;
      const [google,{nonce}]=await Promise.all([loadGoogle(),api('google-challenge','POST')]);
      if(!active()||session!==activeSession)return;
      google.initialize({
        client_id:googleClientId,
        nonce,
        use_fedcm_for_button:true,
        callback:async ({credential})=>{
          if(!active()||session!==activeSession)return;
          target.replaceChildren();
          status('Signing in with Google…');
          try{
            const result=await api('google-sign-in','POST',{credential});
            if(!active()||session!==activeSession)return;
            if(result.enrollment){
              enrollment=result.enrollment;
              $('hubGoogleEnroll').elements.name.value=$('name').value;
              renderSignInOptions();
              $('hubGoogleEnroll').elements.handle.focus();
            }else{
              beginSession(result);
              await refresh();
            }
            status('');
          }catch(error){
            if(!active())return;
            status(error.message);
            $('hubRetryGoogle').hidden=false;
          }
        }
      });
      google.renderButton(target,{theme:'outline',size:'large',text:'signin_with',shape:'rectangular'});
      $('hubGoogleHelp').hidden=false;
    }catch(error){
      if(active()){
        status(error.message);
        $('hubGoogleHelp').hidden=false;
        $('hubRetryGoogle').hidden=false;
      }
    }
  }

  function endSession() {
    session = null;
    write('localStorage',SESSION,null);
    setProfile(null);
  }

  function renderStats(rows) {
    const stats = ['public','custom','ranked'].map(playlist => rows.find(row => row.playlist === playlist) || {});
    const sum = key => stats.reduce((total,row) => total+(row[key]||0),0);
    const lifetime = Object.fromEntries(
      ['matches','wins','kills','deaths','shots','hits','headshots'].map(key=>[key,sum(key)])
    );
    for(const key of ['best_streak','best_score'])lifetime[key]=Math.max(0,...stats.map(row=>row[key]||0));
    const cards=[['Lifetime online',lifetime],['Quick Play',stats[0]],['Custom Rooms',stats[1]],['Ranked',stats[2]]];
    $('hubStats').replaceChildren(...cards.map(([label,row]) => {
      const card = element('article','','hub-stat');
      const accuracy = row.shots ? Math.round(row.hits/row.shots*100) : 0;
      card.append(
        element('h4',label),
        element('p',`${row.matches || 0} matches · ${row.wins || 0} wins`),
        element('p',`${row.kills || 0} eliminations · ${row.deaths || 0} deaths`),
        element('p',`${accuracy}% accuracy · ${row.headshots || 0} headshots`),
        element('p',`Best streak ${row.best_streak || 0} · Best score ${row.best_score || 0}`)
      );
      return card;
    }));
    const awards = [
      ['On the Board','Complete your first online match',sum('matches')>=1],
      ['First Elimination','Earn an online elimination',sum('kills')>=1],
      ['Hot Hand','Get a 5-elimination streak',stats.some(row=>row.best_streak>=5)],
      ['Sharpshooter','Land 25 headshot eliminations',sum('headshots')>=25],
      ['Arena Regular','Complete 25 online matches',sum('matches')>=25],
      ['Public Rival','Eliminate 10 humans in Public Online',(stats[0].human_kills||0)>=10]
    ];
    $('hubAwards').replaceChildren(...awards.map(([name,detail,earned])=>{
      const card = element('article','','hub-award');
      card.dataset.earned = String(earned);
      card.append(element('b',name),element('p',detail),element('small',earned?'EARNED':'LOCKED'));
      return card;
    }));
  }

  function renderFriends(friends) {
    lastFriends=friends;
    friendRequests=friends.filter(friend=>friend.status==='received').length;
    renderInboxCount();
    const list = $('hubFriendsList');
    if(!friends.length){
      list.replaceChildren(element('p','Add a friend by their exact @handle.','hub-empty'));
      return;
    }
    list.replaceChildren(...friends.map(friend => {
      const row = element('div','','hub-person');
      const label = {friend:'Friend',received:'Incoming request',sent:'Request sent'}[friend.status];
      row.append(element('span',`${friend.name} · @${friend.handle} · ${label}`,'hub-name'));
      const action = (name,kind) => {
        const button = element('button',name,'secondary');
        button.type = 'button';
        button.onclick = async () => {
          button.disabled = true;
          try{
            const result = await api('friends','POST',{handle:friend.handle,action:kind});
            renderFriends(result.friends);
            status('');
          }catch(error){status(error.message);}
          finally{button.disabled = false;}
        };
        row.append(button);
      };
      if(friend.status==='received')action('Accept','accept');
      const party=squadState.party;
      if(friend.status==='friend'&&!activeRoom&&(!party||(party.leader===current?.handle&&party.members.length<4))){
        row.append(squadButton('Squad invite',async()=>{
          if(!squadState.party&&!await squadAction('create'))return;
          if(await squadAction('invite',{handle:friend.handle}))status('Squad invite sent.');
        }));
      }
      if(friend.status==='friend'&&activeRoom){
        const invite=element('button','Invite','secondary');
        invite.type='button';
        invite.onclick=async()=>{
          invite.disabled=true;
          try{await api('invites','POST',{handle:friend.handle,code:activeRoom});status('Room invite sent.');}
          catch(error){status(error.message);}
          finally{invite.disabled=false;}
        };
        row.append(invite);
      }
      action(friend.status==='friend'?'Remove':friend.status==='received'?'Decline':'Cancel','remove');
      return row;
    }));
  }

  function renderInvites(invites) {
    roomInvites=invites.length;
    renderInboxCount();
    $('hubInvites').replaceChildren(...invites.map(invite=>{
      const row=element('div','','hub-person');
      const join=element('button','Join room','secondary');
      const dismiss=element('button','Dismiss','secondary');
      join.type=dismiss.type='button';
      join.onclick=()=>{
        dialog.close();
        joinRoom(invite.code);
      };
      dismiss.onclick=async()=>{
        dismiss.disabled=true;
        try{
          const result=await api('invites','POST',{action:'dismiss',handle:invite.handle});
          renderInvites(result.invites);
        }catch(error){status(error.message);}
        finally{dismiss.disabled=false;}
      };
      row.append(element('span',`${invite.name} · room invite`,'hub-name'),join,dismiss);
      return row;
    }));
  }

  async function refresh() {
    const activeSession = session;
    if(!activeSession)return;
    try{
      const data = await api('profile');
      if(session!==activeSession)return;
      setProfile(data.profile);
      const ranked=data.ranked;
      $('hubStanding').textContent=ranked.rating===null?`Ranked placement · ${ranked.played}/${ranked.placements} matches`:
        `Ranked rating ${ranked.rating} · ${ranked.wins} wins`;
      renderStats(data.stats);
      renderFriends(data.friends);
      renderInvites(data.invites);
    }catch(error){
      if(session!==activeSession)return;
      if(error.status===401)endSession();
      status(error.message);
    }
  }

  async function select(tab) {
    section = tab;
    googleAttempt++;
    status('');
    for(const button of dialog.querySelectorAll('[data-hub-tab]')){
      const selected = button.dataset.hubTab === tab;
      button.classList.toggle('selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    }
    for(const name of ['Profile','Friends','Squad','Rankings'])$('hub'+name).hidden = name.toLowerCase()!==tab;
    if(tab==='squad'){
      renderSquad();
      await pollSquad();
      return;
    }
    if(tab==='rankings'){
      const list=$('hubRankList');
      const kind=$('rankingKind').value;
      const competitive=kind==='ranked-ladder';
      $('rankingDescription').textContent=competitive
        ?'Top 25 by TDM rating. Complete five placement matches to appear.'
        :'Top 25 by human eliminations in Quick Play. Wins break ties.';
      list.replaceChildren();
      try{
        const {ranks}=await api(kind);
        if(section!==tab||$('rankingKind').value!==kind)return;
        if(!ranks.length)status(competitive?'No players have completed placements yet.':'No public eliminations have been recorded yet.');
        list.replaceChildren(...ranks.map(row=>element('li',
          `${row.name} · @${row.handle} — ${competitive?row.rating+' rating':row.eliminations+' eliminations'} · ${row.wins} wins`)));
      }catch(error){if(section===tab)status(error.message);}
    }else{
      await refresh();
      if(tab==='profile'&&section===tab)prepareGoogle();
    }
  }

  function form(id, submit) {
    const node = $(id);
    node.addEventListener('submit',async event=>{
      event.preventDefault();
      const button = node.querySelector('button');
      button.disabled = true;
      status('');
      try{await submit(Object.fromEntries(new FormData(node)));}
      catch(error){status(error.message);}
      finally{button.disabled = false;}
    });
  }

  function beginSession(data) {
    session = data.session;
    write('localStorage',SESSION,session);
    setProfile(data.profile);
    renderStats([]);
    renderFriends([]);
    renderInvites([]);
    pollSquad();
  }

  form('hubGoogleEnroll',async data=>{
    try{
      const result=await api('google-enroll','POST',{...data,enrollment});
      enrollment=null;
      beginSession(result);
      $('hubGoogleEnroll').reset();
      await refresh();
    }catch(error){
      if(error.status===401){
        enrollment=null;
        renderSignInOptions();
        prepareGoogle();
      }
      throw error;
    }
  });
  $('hubRetryGoogle').onclick=()=>{status('');prepareGoogle();};
  $('hubCancelEnrollment').onclick=()=>{
    enrollment=null;
    renderSignInOptions();
    prepareGoogle();
  };
  form('hubRename',async data=>{
    const {profile} = await api('profile','PATCH',data);
    setProfile(profile);
    status('Callsign saved.');
  });
  form('hubAddFriend',async data=>{
    const result = await api('friends','POST',{...data,action:'request'});
    $('hubAddFriend').reset();
    renderFriends(result.friends);
    status('Friend request sent.');
  });

  $('hubSignOut').onclick = async () => {
    try{
      await api('sign-out','POST');
      endSession();
      status('Signed out. Guest play is available.');
      prepareGoogle();
    }catch(error){
      if(error.status===401)endSession();
      status(error.message);
    }
  };
  function open(room = null,tab='profile'){
    activeRoom=room;
    for(const button of dialog.querySelectorAll('[data-hub-tab]')){
      button.hidden=Boolean(room)&&button.dataset.hubTab!=='friends';
    }
    if(!dialog.open)dialog.showModal();
    clearInterval(inboxTimer);
    select(room?'friends':tab);
    inboxTimer=setInterval(()=>{if(section==='friends'&&session)refresh();},10_000);
  }
  $('openPlayerHub').onclick = () => open();
  $('hubContinueGuest').onclick=()=>dialog.close();
  $('rankingKind').onchange=()=>select('rankings');
  $('closePlayerHub').onclick = () => dialog.close();
  dialog.addEventListener('close',()=>{
    googleAttempt++;
    clearInterval(inboxTimer);
  });
  for(const button of dialog.querySelectorAll('[data-hub-tab]'))button.onclick = () => select(button.dataset.hubTab);
  renderSignInOptions();
  refresh();
  pollSquad();
  setInterval(pollSquad,2500);
  setInterval(()=>{
    if(session&&!dialog.open&&!document.hidden&&!$('lobby').hidden)refresh();
  },30_000);

  return {
    open,
    queueSquad:rules=>changeSquad('queue',{rules}),
    cancelSquad:()=>changeSquad('cancel'),
    queueRanked:action=>api('ranked-queue','POST',{action}),
    rankedResult:id=>api('ranked-result','POST',{id}),
    async ticket() {
      if(!session)return undefined;
      try{return (await api('ticket','POST')).ticket;}
      catch(error){
        if(error.status===401){
          endSession();
          throw new Error('Your sign-in expired. Open Player Hub to sign in again, or continue as a guest.');
        }
        throw error;
      }
    }
  };
}
