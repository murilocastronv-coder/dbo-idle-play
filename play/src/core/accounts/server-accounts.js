// =====================================================================
// Forgotten Lands - contas salvas no servidor (PostgreSQL).
//
// A sessao e um token Bearer guardado no navegador. Assim o mesmo codigo
// funciona com o jogo servido pelo proprio servidor ou por um site estatico
// (GitHub Pages / Render static) falando com o servidor em outro dominio.
// =====================================================================
import { resolveApiBase } from '../network/socket-client-social.js?v=22.6.1';

const TOKEN_KEY = 'forgotten-lands-session-v1';
const API_BASE = resolveApiBase();
const LEGACY_ACCOUNTS_KEY = 'dbo-idle-mock-accounts-v1';
const LEGACY_CHARACTER_KEY = 'dbo-idle-v12-12-save';
const MAX_CHARACTERS = 10;
const NICKNAME_PATTERN = /^[A-Za-z ]+$/;
const saveTimers = new Map();
const pendingStates = new Map();
let lastSaveError = '';

function readToken(){try{return localStorage.getItem(TOKEN_KEY)||'';}catch{return '';}}
function writeToken(token){try{if(token)localStorage.setItem(TOKEN_KEY,token);else localStorage.removeItem(TOKEN_KEY);}catch{}}
function authHeaders(){const token=readToken();return token?{Authorization:`Bearer ${token}`}:{};}

async function api(path, options={}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      cache:'no-store',
      ...options,
      headers:{'Content-Type':'application/json', ...authHeaders(), ...(options.headers||{})}
    });
  } catch {
    // Render free hiberna: o primeiro acesso pode levar ~1 minuto.
    const error = new Error('Nao foi possivel falar com o servidor. Ele pode estar acordando: tente de novo em alguns segundos.');
    error.status = 0;
    throw error;
  }
  let body={};
  try { body=await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body.message || `Erro HTTP ${response.status}`);
    error.status=response.status;
    error.payload=body;
    throw error;
  }
  return body;
}

function readLegacyAccounts() {
  try {
    const value=JSON.parse(localStorage.getItem(LEGACY_ACCOUNTS_KEY));
    return Array.isArray(value)?value:[];
  } catch { return []; }
}

async function migrateLegacyIfPossible(account) {
  if (!account || account.characters?.length) return {account,migrated:0,skipped:[]};
  const local = readLegacyAccounts().find(entry =>
    String(entry.email||'').trim().toLowerCase() === String(account.email||'').trim().toLowerCase()
  );
  let characters = local?.characters || [];
  if (!characters.length) {
    try {
      const legacy=JSON.parse(localStorage.getItem(LEGACY_CHARACTER_KEY));
      if (legacy?.profile) characters=[legacy];
    } catch {}
  }
  if (!characters.length) return {account,migrated:0,skipped:[]};
  try {
    const result = await api('/api/account/import-local',{
      method:'POST',body:JSON.stringify({characters})
    });
    return {
      account:result.account || account,
      migrated:result.imported?.length || 0,
      skipped:result.skipped || []
    };
  } catch (error) {
    console.warn('[DB] Nao foi possivel importar o save local:',error.message);
    return {account,migrated:0,skipped:[],migrationError:error.message};
  }
}

export function validateNickname(value, account=null) {
  const nickname=String(value||'').trim().replace(/\s+/g,' ');
  if(nickname.length<3 || nickname.length>16){
    return {ok:false,message:'O nickname deve ter entre 3 e 16 caracteres.'};
  }
  if(!NICKNAME_PATTERN.test(nickname)){
    return {ok:false,message:'Use somente letras sem acentos e espacos.'};
  }
  if(account?.characters?.some(character =>
    character.profile.name.toLowerCase()===nickname.toLowerCase())){
    return {ok:false,message:'Ja existe um personagem com esse nickname nesta conta.'};
  }
  return {ok:true,nickname};
}

export async function requestRegistrationCode(email) {
  try {
    const result=await api('/api/auth/register/request-code',{
      method:'POST',body:JSON.stringify({email})
    });
    return {ok:true,email:result.email,expiresInSeconds:result.expiresInSeconds,message:result.message};
  } catch(error){return {ok:false,message:error.message,status:error.status}}
}

export async function createAccount(email,password,code) {
  try {
    const result=await api('/api/auth/register',{
      method:'POST',body:JSON.stringify({email,password,code})
    });
    writeToken(result.token);
    const migration=await migrateLegacyIfPossible(result.account);
    return {ok:true,account:migration.account,migration};
  } catch(error){return {ok:false,message:error.message,status:error.status}}
}

export async function loginAccount(email,password) {
  try {
    const result=await api('/api/auth/login',{
      method:'POST',body:JSON.stringify({email,password})
    });
    writeToken(result.token);
    const migration=await migrateLegacyIfPossible(result.account);
    return {ok:true,account:migration.account,migration};
  } catch(error){return {ok:false,message:error.message}}
}

export async function requestPasswordResetCode(email) {
  try {
    const result=await api('/api/auth/password/request-code',{
      method:'POST',body:JSON.stringify({email})
    });
    return {ok:true,email:result.email,expiresInSeconds:result.expiresInSeconds,message:result.message};
  } catch(error){return {ok:false,message:error.message,status:error.status}}
}

export async function resetAccountPassword(email,password,code) {
  try {
    const result=await api('/api/auth/password/reset',{
      method:'POST',body:JSON.stringify({email,password,code})
    });
    return {ok:true,message:result.message};
  } catch(error){return {ok:false,message:error.message,status:error.status}}
}

export async function logoutAccount() {
  try { await api('/api/auth/logout',{method:'POST',body:'{}'}); } catch {}
  writeToken('');
}

export async function currentAccount() {
  if(!readToken())return null;
  try { return (await api('/api/account')).account || null; }
  catch(error){ if(error.status===401)writeToken(''); else console.warn('[DB] Sessao:',error.message); return null; }
}

export async function addCharacterToAccount(account, characterState) {
  if((account.characters||[]).length>=MAX_CHARACTERS){
    return {ok:false,message:'A conta ja possui 10 personagens.'};
  }
  const validation=validateNickname(characterState.profile.name,account);
  if(!validation.ok)return validation;
  try{
    const result=await api('/api/characters',{
      method:'POST',
      body:JSON.stringify({
        name:validation.nickname,
        characterId:characterState.profile.characterId,
        state:characterState
      })
    });
    account.characters ||= [];
    account.characters.push(result.state);
    account.activeCharacterId=result.state.profile.id;
    return {ok:true,character:result.state};
  }catch(error){return {ok:false,message:error.message}}
}

export async function removeCharacterFromAccount(account,characterId){
  try{
    await flushCharacterSave(characterId);
    await api(`/api/characters/${encodeURIComponent(characterId)}`,{method:'DELETE',body:'{}'});
    account.characters=(account.characters||[]).filter(c=>c.profile.id!==characterId);
    if(account.activeCharacterId===characterId)account.activeCharacterId=account.characters[0]?.profile.id||null;
    return {ok:true};
  }catch(error){return {ok:false,message:error.message}}
}

export function selectAccountCharacter(account,characterId){
  const character=(account.characters||[]).find(entry=>entry.profile.id===characterId);
  if(!character)return null;
  account.activeCharacterId=characterId;
  return character;
}

async function sendCharacterSave(characterId,state){
  try{
    const result=await api(`/api/characters/${encodeURIComponent(characterId)}/state`,{
      method:'PUT',body:JSON.stringify({state})
    });
    lastSaveError='';
    return result.state || state;
  }catch(error){
    lastSaveError=error.message;
    console.error('[DB] Falha ao salvar personagem:',error.message);
    throw error;
  }
}

export function updateAccountCharacter(account,state){
  const index=(account.characters||[]).findIndex(character=>character.profile.id===state.profile.id);
  if(index<0)(account.characters ||= []).push(state); else account.characters[index]=state;
  account.activeCharacterId=state.profile.id;
  pendingStates.set(state.profile.id,structuredClone(state));
  clearTimeout(saveTimers.get(state.profile.id));
  saveTimers.set(state.profile.id,setTimeout(()=>{
    const pending=pendingStates.get(state.profile.id);
    if(!pending)return;
    pendingStates.delete(state.profile.id);
    saveTimers.delete(state.profile.id);
    sendCharacterSave(state.profile.id,pending).catch(()=>{});
  },900));
}

export async function flushCharacterSave(characterId){
  clearTimeout(saveTimers.get(characterId));
  saveTimers.delete(characterId);
  const state=pendingStates.get(characterId);
  if(!state)return;
  pendingStates.delete(characterId);
  await sendCharacterSave(characterId,state);
}

export function discardCharacterSave(characterId){
  clearTimeout(saveTimers.get(characterId));
  saveTimers.delete(characterId);
  pendingStates.delete(characterId);
}

export function flushCharacterSaveOnUnload(characterId){
  clearTimeout(saveTimers.get(characterId));
  const state=pendingStates.get(characterId);
  if(!state)return;
  pendingStates.delete(characterId);
  fetch(`${API_BASE}/api/characters/${encodeURIComponent(characterId)}/state`,{
    method:'PUT',keepalive:true,
    headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({state})
  }).catch(()=>{});
}

export function databaseSaveStatus(){return lastSaveError?{ok:false,message:lastSaveError}:{ok:true}}

export const accountLimits={maxCharacters:MAX_CHARACTERS,nicknameMaxLength:16};
