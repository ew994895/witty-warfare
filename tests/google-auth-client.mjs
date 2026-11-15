import {randomBytes,randomUUID} from 'node:crypto';

export async function signInFixture(post, subject) {
  const {nonce}=await post('google-challenge',{});
  return post('google-sign-in',{credential:JSON.stringify({nonce,subject})});
}

export async function createFixturePlayer(post, name) {
  const subject='qa-'+randomUUID();
  const handle='qa_'+randomBytes(5).toString('hex');
  const {enrollment}=await signInFixture(post,subject);
  const account=await post('google-enroll',{enrollment,handle,name},undefined,201);
  return {...account,subject,handle};
}
