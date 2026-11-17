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
  let lastFriends=[], friendsVersion=0;
  write('localStorage','witty-player-session',null);
  write('sessionStorage','witty-pending-sign-in-key',null);
  const dialog = $('playerHub');
  const status = text => {$('hubStatus').textContent = text;};
  const lobbyStatus = text => {$('lobbySquadStatus').textContent = text;};
  const squadPanel=$('squadLobby');

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
    const changedAccount=current?.handle!==profile?.handle;
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
      squadPanel.open=false;
      lobbyStatus('');
      setSquad({party:null,invites:[]});
    }
    renderInboxCount();
    renderSignInOptions();
    if(changedAccount)renderLobbySquad();
    onProfile(profile);
  }

  function renderSignInOptions() {
    $('hubGoogle').hidden=Boolean(current||enrollment);
    $('hubGoogleEnroll').hidden=!enrollment;
    $('hubTabs').hidden=!current&&section!=='rankings';
    dialog.classList.toggle('hub-sign-in',!current&&section==='profile');
    $('hubHeading').textContent=activeRoom?'Invite to room':current?'Player Hub':
      section==='rankings'?'Rankings':enrollment?'Create your profile':'Sign in to play together';
    $('closePlayerHub').setAttribute('aria-label','Close '+$('hubHeading').textContent);
    for(const button of $('hubTabs').querySelectorAll('button')){
      button.hidden=activeRoom?button.dataset.hubTab!=='friends':!current&&button.dataset.hubTab==='friends';
      if(button.dataset.hubTab==='profile')button.textContent=current?'Profile':'Sign in';
    }
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
    const incoming=data.invites.some(invite=>!squadState.invites.some(previous=>previous.squad===invite.squad));
    squadKey=key;
    squadState=data;
    renderInboxCount();
    if(incoming&&!$('lobby').hidden&&!dialog.open)squadPanel.open=true;
    renderLobbySquad();
    if(dialog.open&&section==='friends'&&!activeRoom)renderFriends(lastFriends);
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

  function actionButton(label,handler,primary=false) {
    const button=element('button',label,primary?'secondary social-primary':'secondary');
    button.type='button';
    button.onclick=async ()=>{
      button.disabled=true;
      try{await handler();}
      finally{button.disabled=false;}
    };
    return button;
  }

  function personRow(name,detail,actions=[],className='') {
    const row=element('div','','hub-person'+(className?' '+className:''));
    const identity=element('div','','hub-person-identity');
    identity.append(element('strong',name,'hub-name'));
    if(detail)identity.append(element('span',detail,'hub-person-detail'));
    row.append(identity);
    if(actions.length){
      const controls=element('div','','hub-person-actions');
      controls.append(...actions);
      row.append(controls);
    }
    return row;
  }

  function canInvite(friend) {
    const {party}=squadState;
    return friend.status==='friend'&&!party?.members.some(member=>member.handle===friend.handle)
      &&(!party||(party.leader===current?.handle&&party.members.length<4&&(!party.match||party.match.live)));
  }

  function inviteButton(friend,report) {
    if(squadState.sent?.includes(friend.handle))return element('span','Invite sent','hub-person-state');
    return actionButton('Invite',async()=>{
      try{
        if(await changeSquad('invite',{handle:friend.handle}))report('');
      }catch(error){report(error.message);}
    },true);
  }

  async function runSquadAction(action,body) {
    try{
      if(await changeSquad(action,body))lobbyStatus('');
    }catch(error){lobbyStatus(error.message);}
  }

  function renderLobbySquad() {
    squadPanel.hidden=!current;
    if(!current)return;
    const {party,invites}=squadState;
    const leader=party?.leader===current.handle;
    const connecting=party?.match&&!party.match.live;
    const requests=lastFriends.filter(friend=>friend.status==='received');
    const count=invites.length+requests.length;
    const badge=$('lobbySquadBadge');
    badge.hidden=count===0;
    badge.textContent=String(count);
    badge.setAttribute('aria-label',count+' pending invitations or requests');
    $('lobbySquadCaption').textContent=connecting?'Connecting…':party?party.members.length+' / 4 players':'Invite friends';
    $('lobbySquadChips').replaceChildren(...(party?.members??[]).filter(member=>member.handle!==current.handle)
      .map(member=>element('span',member.name,'squad-chip')));
    $('lobbySquadInvites').replaceChildren(
      ...invites.map(invite=>personRow(invite.name,'Squad invite',[
        actionButton('Join squad',()=>runSquadAction('accept',{squad:invite.squad}),true),
        actionButton('Decline',()=>runSquadAction('decline',{squad:invite.squad}))
      ],'hub-incoming')),
      ...requests.map(friend=>friendRow(friend,lobbyStatus,true))
    );
    $('lobbySquadRoster').replaceChildren(...(party?.members??[]).map(member=>personRow(
      member.name,
      (member.handle===current.handle?'You · ':'')+(member.handle===party.leader?'Squad leader':'@'+member.handle)
    )));
    $('lobbySquadHint').textContent=connecting?'Keep this lobby open while your squad connects.':
      leader&&party.members.length>1?'Pick a mode and press Squad Quick Play.':
      party&&!leader?'Stay in this lobby. Your squad leader starts the match.':'Invite a friend to play Quick Play together.';
    const actions=$('lobbySquadActions');
    actions.replaceChildren();
    if(party?.match?.canRejoin)actions.append(actionButton('Rejoin match',()=>rejoinSquad(party.match),true));
    if(party)actions.append(actionButton('Leave squad',()=>runSquadAction('leave')));
    const friends=lastFriends.filter(canInvite);
    $('lobbySquadFriends').replaceChildren(...(friends.length?[
      element('h3','Invite friends','lobby-squad-title'),
      ...friends.map(friend=>personRow(friend.name,'@'+friend.handle,[inviteButton(friend,lobbyStatus)]))
    ]:[]));
  }

  async function pollSquad() {
    if(!session||squadBusy||($('lobby').hidden&&!dialog.open))return;
    if(document.hidden&&!squadState.party)return;
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
    $('hubGoogleLoading').hidden=false;
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
      google.renderButton(target,{
        theme:'outline_dark',size:'large',text:'continue_with',shape:'pill',logo_alignment:'left',
        width:String(Math.floor(Math.min(320,target.clientWidth)))
      });
    }catch(error){
      if(active()){
        status(error.message);
        $('hubGoogleHelp').hidden=false;
        $('hubRetryGoogle').hidden=false;
      }
    }finally{
      if(active())$('hubGoogleLoading').hidden=true;
    }
  }

  function endSession() {
    session = null;
    write('localStorage',SESSION,null);
    setProfile(null);
    if(dialog.open&&!activeRoom&&section==='friends')select('profile');
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

  function setFriends(friends) {
    if(JSON.stringify(friends)===JSON.stringify(lastFriends))return;
    lastFriends=friends;
    friendRequests=friends.filter(friend=>friend.status==='received').length;
    renderInboxCount();
    renderLobbySquad();
    if(dialog.open&&section==='friends')renderFriends(friends);
  }

  async function pollFriends() {
    if(!session||document.hidden||($('lobby').hidden&&!dialog.open))return;
    const activeSession=session;
    const version=friendsVersion;
    try{
      const {friends}=await api('friends');
      if(session===activeSession&&version===friendsVersion)setFriends(friends);
    }catch(error){
      if(session===activeSession&&error.status===401)endSession();
    }
  }

  async function changeFriend(handle,action,report) {
    const activeSession=session;
    friendsVersion++;
    try{
      const {friends}=await api('friends','POST',{handle,action});
      if(session!==activeSession)return false;
      setFriends(friends);
      report(action==='request'?'Friend request sent.':'');
      return true;
    }catch(error){report(error.message);return false;}
    finally{friendsVersion++;}
  }

  function friendRow(friend,report,lobby=false) {
    const label={friend:'',received:'Friend request',sent:'Request sent'}[friend.status];
    const actions=[];
    if(friend.status==='received')actions.push(
      actionButton('Accept',()=>changeFriend(friend.handle,'accept',report),true)
    );
    if(friend.status==='friend'&&activeRoom&&!lobby){
      actions.push(actionButton('Invite to room',async()=>{
        try{await api('invites','POST',{handle:friend.handle,code:activeRoom});report('Room invite sent.');}
        catch(error){report(error.message);}
      },true));
    }else if(canInvite(friend)){
      actions.push(inviteButton(friend,report));
    }
    actions.push(actionButton(friend.status==='friend'?'Remove':friend.status==='received'?'Decline':'Cancel',
      ()=>changeFriend(friend.handle,'remove',report)));
    return personRow(friend.name,['@'+friend.handle,label].filter(Boolean).join(' · '),actions);
  }

  function renderFriends(friends) {
    $('hubFriendsList').replaceChildren(...(friends.length?friends.map(friend=>friendRow(friend,status)):
      [element('p','Add a friend by their @handle.','hub-empty')]));
  }

  function renderInvites(invites) {
    roomInvites=invites.length;
    renderInboxCount();
    $('hubInvites').replaceChildren(...invites.map(invite=>{
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
      return personRow(invite.name,'Room invite',[join,dismiss],'hub-incoming');
    }));
  }

  async function refresh() {
    const activeSession = session;
    if(!activeSession)return;
    const version=friendsVersion;
    try{
      const data = await api('profile');
      if(session!==activeSession)return;
      setProfile(data.profile);
      const ranked=data.ranked;
      $('hubStanding').textContent=ranked.rating===null?`Ranked placement · ${ranked.played}/${ranked.placements} matches`:
        `Ranked rating ${ranked.rating} · ${ranked.wins} wins`;
      renderStats(data.stats);
      if(version===friendsVersion)setFriends(data.friends);
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
    for(const name of ['Profile','Friends','Rankings'])$('hub'+name).hidden = name.toLowerCase()!==tab;
    renderSignInOptions();
    if(tab==='friends')renderFriends(lastFriends);
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
    setFriends([]);
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
  for(const [id,report] of [['hubAddFriend',status],['lobbyAddFriend',lobbyStatus]]){
    const node=$(id);
    node.onsubmit=async event=>{
      event.preventDefault();
      const submit=node.querySelector('button');
      submit.disabled=true;
      try{
        if(await changeFriend(node.elements.handle.value,'request',report))node.reset();
      }finally{submit.disabled=false;}
    };
  }

  $('hubSignOut').onclick = async () => {
    try{
      await api('sign-out','POST');
      endSession();
      select('profile');
    }catch(error){
      if(error.status===401)endSession();
      status(error.message);
    }
  };
  function open(room = null,tab='profile'){
    activeRoom=room;
    if(!dialog.open)dialog.showModal();
    clearInterval(inboxTimer);
    select(room?'friends':tab);
    inboxTimer=setInterval(()=>{if(section==='friends'&&session)refresh();},10_000);
  }
  $('openPlayerHub').onclick = () => open();
  $('hubContinueGuest').onclick=()=>dialog.close();
  $('hubGuestRankings').onclick=()=>select('rankings');
  $('lobbyManageFriends').onclick=()=>open(null,'friends');
  document.addEventListener('click',event=>{
    if(squadPanel.open&&!squadPanel.contains(event.target))squadPanel.open=false;
  },true);
  squadPanel.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!squadPanel.open)return;
    squadPanel.open=false;
    squadPanel.querySelector('summary').focus();
  });
  squadPanel.addEventListener('toggle',()=>{
    if(squadPanel.open){pollFriends();pollSquad();}
    else lobbyStatus('');
  });
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
  setInterval(pollFriends,6000);
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
