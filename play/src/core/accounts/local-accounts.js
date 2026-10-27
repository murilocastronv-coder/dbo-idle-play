// =====================================================================
// Forgotten Lands - camada de contas da build estatica (sem servidor).
//
// Exporta exatamente a mesma interface de server-accounts.js, porem
// persistindo tudo em localStorage atraves de mock-accounts.js.
// Nesta build nao existe backend: nao ha envio de e-mail, sessao remota
// nem sincronizacao entre dispositivos. O progresso vive no navegador
// de quem esta jogando.
// =====================================================================
import {
  addCharacterToAccount as addCharacterLocal,
  createMockAccount,
  currentMockAccount,
  loginMockAccount,
  logoutMockAccount,
  mockAccountLimits,
  removeCharacterFromAccount as removeCharacterLocal,
  saveMockAccount,
  selectAccountCharacter as selectCharacterLocal,
  updateAccountCharacter as updateCharacterLocal,
  validateNickname as validateNicknameLocal
} from './mock-accounts.js?v=22.4.4';

const ACCOUNTS_KEY = 'dbo-idle-mock-accounts-v1';
const NO_MIGRATION = {migrated:0, skipped:[]};

export const accountLimits = mockAccountLimits;
export const validateNickname = validateNicknameLocal;
export const selectAccountCharacter = selectCharacterLocal;
export const updateAccountCharacter = updateCharacterLocal;

// Sem servidor de e-mail, o codigo de verificacao deixa de existir.
export async function requestRegistrationCode(email) {
  return {
    ok: true,
    email: String(email || '').trim().toLowerCase(),
    expiresInSeconds: 0,
    message: 'Versao de demonstracao: nao ha envio de e-mail. Digite qualquer codigo para continuar.'
  };
}

export async function createAccount(email, password /* , code */) {
  const result = createMockAccount(email, password);
  return result.ok ? {...result, migration: NO_MIGRATION} : result;
}

export async function loginAccount(email, password) {
  const result = loginMockAccount(email, password);
  return result.ok ? {...result, migration: NO_MIGRATION} : result;
}

export async function logoutAccount() { logoutMockAccount(); }

export async function currentAccount() { return currentMockAccount(); }

export async function addCharacterToAccount(account, characterState) {
  return addCharacterLocal(account, characterState);
}

export async function removeCharacterFromAccount(account, characterId) {
  return removeCharacterLocal(account, characterId);
}

export async function requestPasswordResetCode(email) {
  return {
    ok: true,
    email: String(email || '').trim().toLowerCase(),
    expiresInSeconds: 0,
    message: 'Versao de demonstracao: defina a nova senha direto, sem codigo.'
  };
}

export async function resetAccountPassword(email, password /* , code */) {
  const normalized = String(email || '').trim().toLowerCase();
  if (String(password || '').length < 4) {
    return {ok: false, message: 'A senha deve ter ao menos 4 caracteres.'};
  }
  let accounts = [];
  try { accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || []; } catch {}
  const account = Array.isArray(accounts)
    ? accounts.find(entry => entry.email === normalized)
    : null;
  if (!account) return {ok: false, message: 'Conta nao encontrada neste navegador.'};
  account.password = String(password);
  saveMockAccount(account);
  return {ok: true, message: 'Senha atualizada.'};
}

// mock-accounts grava a cada alteracao, entao nunca ha escrita pendente:
// os tres viram no-op, preservando a assinatura do original.
export async function flushCharacterSave() {}
export function flushCharacterSaveOnUnload() {}
export function discardCharacterSave() {}
export function databaseSaveStatus() { return {ok: true}; }
