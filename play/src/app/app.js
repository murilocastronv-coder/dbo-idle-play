import { senzuItems } from '../data/generated/senzu-items-v2007.js';
import { GAME_PASS_MISSIONS, GAME_PASS_REWARDS, GAME_PASS_XP_PER_LEVEL, GAME_PASS_BASE_LEVELS, DAILY_VIP_BONUS_DAYS, dailyLoginReward, gamePassLevelFromXp, gamePassRewardFor, gamePassRewardLabel } from '../data/game-pass.js';
import { loadState, saveState, resetToEarth } from '../core/storage.js';
import { DONATION_MIN_BRL, donationQuote, normalizeDonationAmount } from '../core/payments/pp-purchase.js?v=22.4.4';
import {
  addItemToInventory,
  canAcceptItem,
  containerSlots,
  containerPath,
  equippedBackpack,
  findEntryByLocation,
  findItemEntry,
  itemQuantity,
  inventoryContainers,
  moveEntryBetweenContainers,
  moveEntryToSlot,
  openContainer,
  removeEntryAt,
  removeItemFromInventory,
  restoreEntryAt,
  setContainerLayoutLocked,
  autoOrganizeContainer,
  setContainerLootFilter,
  extractContainerTree,
  restoreContainerTree,
  usedSlots
} from '../core/inventory/containers.js?v=22.4.4';
import { SocketClient } from '../core/network/socket-client-social.js?v=22.6.1';
import { isRarityEligibleItem, rarityAdjustedItem, rarityDefinition, rollItemRarity } from '../core/items/item-rarity.js';
import { MapRenderer } from '../core/map/map-renderer.js?v=22.5.0';
import { loadWebAssetStatus, loadWebManifest } from '../core/map/web-asset-loader.js';
import {
  equipmentSlots,
  slotNames,
  equipmentRequiredLevel,
  normalizeShieldHandState,
  totalStats,
  equip,
  equipFromContainer,
  unequipToBackpack,
  unequipToContainer,
  unequipBackpackToContainer
} from '../core/equipment/equipment.js';
import { allowedLureCounts, createHuntEngine } from '../core/hunt/hunt-engine.js?v=22.4.4';
import { HuntArenaRenderer } from '../core/hunt/hunt-arena-renderer.js?v=22.4.4';
import { registerFormChains } from '../core/render/outfit-fallback.js?v=22.4.4';
import {
  createTrainingEngine,
  trainingRooms
} from '../core/training/training-engine.js';
import { TrainingRenderer } from '../core/training/training-renderer.js?v=22.4.4';
import { createSpellController } from '../core/spells/spell-engine.js?v=22.4.4';
import {
  applyNextTransformation,
  nextTransformationFor,
  currentTransformationForm,
  rebornChoicesFor
} from '../core/transformations/transformation-engine.js';
import { characterXpProgress, experienceRate, skillDefinitions, skillProgress } from '../core/skills/skills.js?v=22.4.4';
import { maxResources } from '../core/balance/absolute-balance-engine.js';
import { BESTIARY_MILESTONES, BESTIARY_UPGRADES, BOSS_BESTIARY_MILESTONES, BOSS_BESTIARY_UPGRADES, bestiaryAvailablePoints, bestiaryEarnedPoints, bossBestiaryAvailablePoints, bossBestiaryEarnedPoints, bestiaryMonsterProgress, bossBestiaryMonsterProgress, bestiaryUpgradeCostForRank, bossBestiaryUpgradeCostForRank, bestiaryMaximumPoints, bossBestiaryMaximumPoints, ensureBestiaryState, applyBestiaryUpgrade, applyBossBestiaryUpgrade } from '../core/bestiary/bestiary.js';
import { addMail, ensureMailbox, mailRemainingLabel, removeMail } from '../core/mail/mailbox.js';
import { ensureProgressionQuestState, startProgressionQuest, moveProgressionQuest, clearProgressionQuestGuard, markProgressionQuestComplete, abandonProgressionQuest, questTile, findQuestTile, questGuardAt, progressionQuestRemainingMs, progressionQuestExpired } from '../core/quests/progression-quests.js';
import { worldMapLoader } from '../core/map/world-map-loader.js?v=22.4.4';
import {
  characters,
  zones,
  huntCurationReport,
  itemCatalog,
  questCatalog,
  vipProducts,
  standardTransformationTransitions,
  rebornQuest,
  rebornQuestStages,
  rebornVocationMap,
  progressionQuestsV212,
  spells
} from '../data/game-content.js?v=22.4.4';

export function createApp(root, options = {}) {
  const state = loadState(options.state);
  // V21.26.4: retire progression quests that no longer exist in the live
  // catalog. This also releases characters that logged out while one of those quests was active.
  const initialProgressionQuest = ensureProgressionQuestState(state);
  if (initialProgressionQuest.activeQuestId && !progressionQuestsV212.some(entry => String(entry.id) === String(initialProgressionQuest.activeQuestId))) {
    abandonProgressionQuest(state);
  }
  normalizeShieldHandState(state,itemCatalog);
  const onSaveCharacter = options.onSaveCharacter || (() => {});
  const onSwitchCharacter = options.onSwitchCharacter || (() => {});
  let activeView = 'world';
  let characterSwitchSaving = false;
  let marketTab = 'buy';
  let marketData = null;
  let marketLoading = false;
  let marketMessage = '';
  let marketSearch = '';
  let marketCategory = 'all';
  let marketSort = 'recent';
  let marketRarity = 'all';
  let marketAnnounceRarity = 'all';
  let marketHistoryFilter = 'all';
  let marketDialog = null;
  let marketOpen = false;
  let vipStoreOpen = false;
  let vipStoreTab = 'premium';
  let premiumPurchaseOpen = false;
  let premiumPurchase = {step:'select',brl:10,result:null,error:'',loading:false,history:[],historyLoading:false};
  let mercadoPagoDeviceIdCache = '';
  let premiumPaymentPoll = null;
  let dailyGiftOpen = false;
  let gamePassOpen = false;
  let gamePassTab = 'rewards';
  let mailOpen = false;
  let bestiaryOpen = false;
  let bestiaryTab = 'monsters';
  let rankingOpen = false;
  let rankingTab = 'level';
  let rankingData = null;
  let rankingLoading = false;
  let rankingMessage = '';
  let guildOpen = false;
  let guildTab = 'overview';
  let guildRankingSubTab = 'level';
  let guildData = null;
  let guildLoading = false;
  let guildMessage = '';
  let forgeOpen = false;
  let forgeSelectedInstanceId = null;
  let forgeAttempts = 5;
  let bestiarySearch = '';
  let huntAnalyserOpen = false;
  let huntAnalyserPosition = (()=>{try{return JSON.parse(localStorage.getItem('dbo-hunt-analyser-position')||'null')}catch{return null}})();
  let partyPanelOpen = false;
  let friendsPanelOpen = false;
  let friendsMessage = null;
  let partyState = null;
  let partyInvite = null;
  let guildBossInvite = null;
  let guildBossAcceptedCountdown = null;
  let guildBossArenaParticipants = [];
  let guildBossEventMessage = '';
  let guildBossTankStatus = null;
  let guildBossFightDeadlineAt = 0;
  let partyTankStatus = null;
  let guildBossTauntCooldownUntil = 0;
  let profileTab = 'profile';
  let profileCosmeticPicker = null;
  let partyMessage = '';
  let presence = [];
  let playerContextTarget = null;
  let characterProfileOpen = false;
  let characterProfileData = null;
  let tradeInvite = null;
  let tradeState = null;
  let tradeMessage = '';
  let pvpInvite = null;
  let pvpState = null;
  let pvpMessage = '';
  let pvpLastResult = null;
  let pvpWagerCurrency = 'none';
  let pvpWagerAmount = 0;
  let networkStatus = 'offline';
  let mapRenderer = null;
  let huntRenderer = null;
  let trainingRenderer = null;
  let earthMap = null;
  let webRegionImage = null;
  let worldItemRegistry = new Map();
  let webRegionCenter = {x:99,y:189,z:7};
  let assetStatus = {ok:false,error:'Carregando status do pipeline...'};
  let huntChooserOpen = false;
  let trainingChooserOpen = false;
  let pendingTrainingRoomId =
    state.training?.roomId || 'punching-bag';
  let pendingHuntZoneId = state.hunt.zoneId || zones[0].id;
  let pendingLureCount = state.hunt.lureCount || 1;
  let stopHuntConfirmOpen = false;
  let openContainerIds = [];
  let openDepotContainerId = null;
  let lootConfigOpen = false;
  let vendorOpen = false;
  let npcShopOpen = false;
  let rebornNpcOpen = false;
  let npcShopTab = 'buy';
  let npcSelectedBuyId = 'server_12775';
  let npcBuyQuantity = 1;
  let npcSelectedSellKeys = new Set();
  let npcSellBelowRarity = rarityDefinition(state.settings?.npcSellBelowRarity || 'legendary').id;
  let spellBookSlot = null;
  let consumableConfigOpen = null;
  let huntContentTab = 'hunts';
  let huntPage = 0;
  let questPage = 0;
  let questTab = 'all';
  let huntSearchQuery = '';
  let huntMinLevel = '';
  let huntMaxLevel = '';
  let huntFavoritesOnly = false;
  let activeChatTab = 'default';
  let progressionOpen = true;
  let sharedGroundLoot = state.groundLoot || [];
  let pendingGroundPickupId = null;
  let stackMoveDialog = null;
  let offlineReturnTab = 'summary';
  let authoritySyncTimer = null;
  let lastAuthorityLayoutSignature = '';
  let lastAuthorityPreferencesSignature = '';

  // V21.25.6 — reconciliação do movimento no PZ.
  // O cliente desenha o passo imediatamente para a caminhada ficar responsiva,
  // mas a VPS continua autoritativa. Cada passo recebe um sequence id para que
  // um ACK antigo não puxe o sprite de volta quando já existe outro passo em voo.
  let worldMoveSequence = 0;
  let worldMoveDiscardThrough = 0;
  const pendingWorldMoves = new Map();

  function resetWorldMovePrediction(position = null) {
    worldMoveDiscardThrough = worldMoveSequence;
    pendingWorldMoves.clear();
    if (position && mapRenderer) mapRenderer.setPlayer(position);
  }

  function reconcileWorldPosition(rawPosition = {}) {
    const moveSeq = Math.max(0, Math.trunc(Number(rawPosition?.moveSeq || 0)));
    const moveAccepted = rawPosition?.moveAccepted;
    const position = { ...rawPosition };
    delete position.moveSeq;
    delete position.moveAccepted;

    // Teleportes, login e correções que não pertencem a um passo normal sempre
    // vencem a predição local e zeram a fila.
    if (!moveSeq) {
      resetWorldMovePrediction();
      return { position, renderPosition: position, authoritative: true };
    }

    // Respostas de passos que já foram descartados por uma correção não podem
    // reabrir a fila nem produzir outro snap visual.
    if (moveSeq <= worldMoveDiscardThrough) {
      return { position: null, renderPosition: null, authoritative: false, ignored: true };
    }

    const expected = pendingWorldMoves.get(moveSeq) || null;
    for (const seq of [...pendingWorldMoves.keys()]) {
      if (seq <= moveSeq) pendingWorldMoves.delete(seq);
    }

    const matchesExpected = Boolean(expected) &&
      Number(expected.x) === Number(position.x) &&
      Number(expected.y) === Number(position.y) &&
      Number(expected.z) === Number(position.z);
    const accepted = moveAccepted !== false && matchesExpected;

    if (!accepted) {
      // Um passo foi recusado (parede, limite de velocidade ou divergência).
      // Todos os passos mais novos foram calculados sobre a posição prevista,
      // então são invalidados de uma vez e o servidor corrige apenas uma vez.
      worldMoveDiscardThrough = worldMoveSequence;
      pendingWorldMoves.clear();
      return { position, renderPosition: position, authoritative: true, corrected: true };
    }

    // O ACK é válido. Atualize o estado autoritativo, porém, se já existem
    // passos mais novos em voo, mantenha visualmente a previsão mais recente.
    let renderPosition = position;
    if (pendingWorldMoves.size) {
      const newestSeq = Math.max(...pendingWorldMoves.keys());
      renderPosition = pendingWorldMoves.get(newestSeq) || position;
    }
    return { position, renderPosition, authoritative: true };
  }

  function worldPresencePlayers() {
    return presence.filter(player => !player.activity || player.activity === 'world');
  }

  function applyAuthoritativeState(snapshot = {}) {
    // Equipment/container HTML is not rebuilt by updateDynamicPanels(). Track
    // those sections explicitly so an authoritative equip/backpack change is
    // visible immediately instead of waiting for another unrelated render.
    const equipmentBefore = snapshot.equipment != null
      ? JSON.stringify(state.equipment || {})
      : null;
    const containersBefore = snapshot.containers != null
      ? JSON.stringify(state.containers || {})
      : null;
    const equipmentMetaBefore = snapshot.equipmentMeta != null ? JSON.stringify(state.equipmentMeta || {}) : null;
    const forgeBefore = snapshot.forge != null ? JSON.stringify(state.forge || {pending:null}) : null;
    const progressionQuestBefore = snapshot.progressionQuest != null
      ? JSON.stringify(state.progressionQuest || {})
      : null;
    const gamePassBefore = snapshot.profile != null
      ? JSON.stringify({
          xp:state.profile?.gamePassXp||0,
          missions:state.profile?.gamePassClaimedMissions||[],
          free:state.profile?.gamePassClaimedFree||[],
          premium:state.profile?.gamePassClaimedPremium||[],
          pass:Boolean(state.profile?.gamePass)
        })
      : null;
    const mailboxBefore = snapshot.profile != null ? JSON.stringify(state.profile?.mailbox||[]) : null;
    const offlineModeBefore = snapshot.hunt != null ? JSON.stringify(state.hunt?.offlineMode||{}) : null;

    // Timestamps autoritativos chegam no relogio da VPS. Rebase efeitos e
    // cooldowns para o relogio local do navegador; sem isso alguns PCs viam
    // spells liberarem cedo/tarde mesmo com o servidor calculando corretamente.
    if (snapshot.serverTime != null) {
      const offset = Date.now() - Number(snapshot.serverTime);
      const needsRebase = Boolean(
        snapshot.hunt?.effects?.length ||
        snapshot.spellCooldowns ||
        snapshot.spellCooldownGroups
      );
      if(needsRebase){
        snapshot = structuredClone(snapshot);
        if(snapshot.hunt?.effects?.length){
          snapshot.hunt.effects = snapshot.hunt.effects.map(effect => ({
            ...effect,
            createdAt:Number(effect.createdAt || 0) + offset
          }));
        }
        for(const key of ['spellCooldowns','spellCooldownGroups']){
          if(!snapshot[key])continue;
          snapshot[key]=Object.fromEntries(Object.entries(snapshot[key]).map(([id,readyAt])=>[
            id,
            Number(readyAt||0)>0?Number(readyAt||0)+offset:0
          ]));
        }
      }
    }

    if (snapshot.profile) state.profile = {...state.profile, ...structuredClone(snapshot.profile)};
    for (const key of [
      'skills','temple','hunt','training','protectionFarming','rebornQuest','questStorages','bestiary','progressionQuest','forge',
      'completedQuests','containers','equipment','equipmentMeta','spellCooldowns',
      'spellCooldownGroups','supportSpellCooldowns'
    ]) {
      if (snapshot[key] != null) state[key] = structuredClone(snapshot[key]);
    }
    if (snapshot.depotContainerId != null) state.depotContainerId = snapshot.depotContainerId;
    if (snapshot.vipDepotContainerIds != null) state.vipDepotContainerIds = structuredClone(snapshot.vipDepotContainerIds);
    state.characterDefinition = characters[state.profile.characterId];

    const equipmentChanged = equipmentBefore != null &&
      equipmentBefore !== JSON.stringify(state.equipment || {});
    const containersChanged = containersBefore != null &&
      containersBefore !== JSON.stringify(state.containers || {});
    const equipmentMetaChanged = equipmentMetaBefore != null && equipmentMetaBefore !== JSON.stringify(state.equipmentMeta || {});
    const forgeChanged = forgeBefore != null && forgeBefore !== JSON.stringify(state.forge || {pending:null});
    const progressionQuestChanged = progressionQuestBefore != null && progressionQuestBefore !== JSON.stringify(state.progressionQuest || {});
    const gamePassChanged = gamePassBefore != null && gamePassBefore !== JSON.stringify({
      xp:state.profile?.gamePassXp||0,
      missions:state.profile?.gamePassClaimedMissions||[],
      free:state.profile?.gamePassClaimedFree||[],
      premium:state.profile?.gamePassClaimedPremium||[],
      pass:Boolean(state.profile?.gamePass)
    });
    const mailboxChanged = mailboxBefore != null && mailboxBefore !== JSON.stringify(state.profile?.mailbox||[]);
    const offlineModeChanged = offlineModeBefore != null && offlineModeBefore !== JSON.stringify(state.hunt?.offlineMode||{});

    // O relatório Offline é um overlay estrutural. updateDynamicPanels() não
    // remove esse HTML; quando active/settled muda é obrigatório reconstruir.
    if(offlineModeChanged){
      if(!state.hunt?.offlineMode?.active){
        activeView='world';
        huntChooserOpen=false;
        offlineReturnTab='summary';
      }
      requestAnimationFrame(()=>render());
      return;
    }

    if (progressionQuestChanged && activeView === 'quest-expedition') {
      requestAnimationFrame(() => render());
      return;
    }
    if (gamePassChanged && gamePassOpen) {
      requestAnimationFrame(() => render());
      return;
    }
    if (mailboxChanged && mailOpen) {
      requestAnimationFrame(() => render());
      return;
    }
    if (forgeChanged && forgeOpen) {
      requestAnimationFrame(() => render());
      return;
    }

    // Equipment always needs a paperdoll rebuild. An opened BP/Depot window
    // also needs rebuilt slot HTML when the authoritative container changes.
    if (equipmentChanged || equipmentMetaChanged) {
      requestAnimationFrame(() => render());
      return;
    }
    // V20.63: loot/container sync must not rebuild the whole application.
    // A full render closed native selects, flashed opened backpacks and reset
    // scrollable panels whenever a monster died. updateDynamicPanels refreshes
    // only the container/shop fragments whose data actually changed.
    if (containersChanged && npcShopOpen && npcShopTab === 'sell') {
      npcSelectedSellKeys = new Set([...npcSelectedSellKeys].filter(key => {
        const [containerId,index] = String(key).split(':');
        return Boolean(findEntryByLocation(state,containerId,Number(index))?.entry);
      }));
      render();
      return;
    }
    updateDynamicPanels?.({containersChanged});
  }


  // NPCs fixos do mundo (PZ de Earth). Posições relativas ao spawn
  // (EARTH_SPAWN = 99,189,7 em src/core/storage.js).
  const worldNpcs = [
    {
      id:'bulma',
      name:'Bulma',
      x:95, y:177, z:7,
      outfitId:'bulma',
      direction:2
    },
    {
      id:'depot-1',
      name:'Depot Stash 1',
      x:89, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'depot-2',
      name:'Depot Stash 2',
      x:91, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'depot-3',
      name:'Depot Stash 3',
      x:93, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'depot-4',
      name:'Depot Stash 4',
      x:95, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'depot-5',
      name:'Depot Stash 5',
      x:97, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'depot-6',
      name:'Depot Stash 6',
      x:99, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'depot-7',
      name:'Depot Stash 7',
      x:101, y:172, z:7,
      icon:'./assets/generated/full-registry/previews/item/3497.png'
    },
    {
      id:'reborn',
      name:'Reborn',
      x:rebornQuest.rebornNpc.x,
      y:rebornQuest.rebornNpc.y,
      z:rebornQuest.rebornNpc.z,
      outfitId:'exact-voc-386',
      direction:2
    }
  ];

  function ensureRebornQuestState() {
    state.rebornQuest ||= {
      started:false,
      stage:0,
      readyForReborn:false,
      completed:false
    };
    state.questStorages ||= {};
    state.completedQuests ||= [];
    if (Number(state.questStorages[rebornQuest.storageId] || 0) === rebornQuest.completedStorageValue) {
      state.rebornQuest.completed = true;
      state.rebornQuest.readyForReborn = false;
      if (!state.completedQuests.includes(rebornQuest.id)) state.completedQuests.push(rebornQuest.id);
    }
    return state.rebornQuest;
  }

  function forgeAvailable() {
    // V21.21: the visible activity view is the source of truth. Old character
    // saves can retain stale hunt/training flags after switching characters;
    // those flags must not hide Forge while the player is visibly in PZ.
    return activeView==='world';
  }

  function marketAvailable() {
    // Same rule as Forge: Hunt, Boss, Quest and Training all use a non-world
    // activity view, while stale per-character flags no longer hide Market.
    return activeView==='world';
  }

  function currentRebornStageIndex() {
    const quest = ensureRebornQuestState();
    return Math.max(
      0,
      Math.min(rebornQuestStages.length - 1, Number(quest.stage || 0))
    );
  }

  function currentRebornZone() {
    const stage = rebornQuestStages[currentRebornStageIndex()];
    return zones.find(zone => zone.id === stage?.id) || null;
  }

  function teleportToRebornStage(stageIndex = currentRebornStageIndex()) {
    const index = Math.max(0, Math.min(
      rebornQuestStages.length - 1,
      Number(stageIndex || 0)
    ));
    const target = rebornQuest.stageEntries?.[index]
      || (index === 0 ? rebornQuest.travelStart : null);
    if (!target) return false;

    state.temple = {
      ...target,
      direction:target.direction ?? 2
    };
    const char = characters[state.profile.characterId];
    mapRenderer?.setPlayer({
      ...state.temple,
      name:state.profile.name,
      sprite:characterPortrait(char),
      outfitId:characterOutfitId(char),
      direction:state.temple.direction,
      moving:false
    });
    if (socket?.connected) {
      socket.send({type:'teleport-reborn-stage', stage:index});
    }
    persist();
    updateCoordinates();
    return true;
  }

  function teleportToRebornNpcArea() {
    const quest = ensureRebornQuestState();
    if (!quest.readyForReborn || quest.completed) return false;
    hunt.stop();
    state.temple = {
      ...rebornQuest.finalTeleport,
      direction:0
    };
    if (socket?.connected) {
      socket.send({type:'teleport-reborn-final'});
    }
    activeView = 'world';
    huntChooserOpen = false;
    pendingHuntZoneId = null;
    persist();
    log('Porunga derrotado. O caminho até o NPC Reborn foi liberado.');
    render();
    return true;
  }

  function handleRebornWorldStep(position = state.temple) {
    const exit = rebornQuest.exitTeleport;
    if (!exit) return false;
    if (
      Number(position?.x) !== Number(exit.x) ||
      Number(position?.y) !== Number(exit.y) ||
      Number(position?.z) !== Number(exit.z)
    ) return false;

    resetToEarth(state);
    activeView = 'world';
    rebornNpcOpen = false;
    huntChooserOpen = false;
    pendingHuntZoneId = null;
    const char = characters[state.profile.characterId];
    mapRenderer?.setPlayer({
      ...state.temple,
      name:state.profile.name,
      sprite:characterPortrait(char),
      outfitId:characterOutfitId(char),
      direction:state.temple.direction ?? 2,
      moving:false
    });
    if (socket?.connected) {
      socket.send({type:'teleport-home'});
    }
    persist();
    log('Você retornou ao Templo de Earth.');
    updateCoordinates();
    return true;
  }

  function beginRebornQuest() {
    const quest = ensureRebornQuestState();
    const level = Number(state.profile.level || 1);
    if (quest.completed || Number(state.questStorages[rebornQuest.storageId] || 0) === rebornQuest.completedStorageValue) {
      log('Você já concluiu o Reborn.');
      return false;
    }
    if (level < rebornQuest.minimumLevel || level > rebornQuest.maximumLevel) {
      log(`A Quest Reborn exige level ${rebornQuest.minimumLevel} até ${rebornQuest.maximumLevel}.`);
      return false;
    }
    if (quest.readyForReborn) return teleportToRebornNpcArea();

    const selected = currentRebornZone();
    if (!selected) return false;
    quest.started = true;
    teleportToRebornStage(currentRebornStageIndex());
    huntChooserOpen = false;
    pendingHuntZoneId = selected.id;
    pendingLureCount = 1;
    const zoneChanged = hunt.setZone(selected.id, 1);
    if (!zoneChanged) {
      log('Não foi possível entrar na etapa correta da Quest Reborn.');
      return false;
    }
    activeView = 'hunt';
    const started = hunt.start();
    if (!started) {
      activeView = 'world';
      log('A Quest Reborn não pôde ser iniciada.');
      return false;
    }
    log(`Quest Reborn iniciada: ${selected.monsters[0].name}.`);
    persist();
    render();
    return true;
  }

  function handleRebornBossDefeat({monster, zoneId}) {
    const zone = zones.find(entry => entry.id === zoneId);
    if (zone?.questType !== 'reborn') return;
    const quest = ensureRebornQuestState();
    if (quest.completed) return;

    const stageIndex = Number(zone.questStage || 0);
    if (stageIndex !== Number(quest.stage || 0)) return;
    const stage = rebornQuestStages[stageIndex];
    if (!stage || monster.name !== stage.name) return;

    quest.stage = stageIndex + 1;
    if (quest.stage >= rebornQuestStages.length) {
      quest.readyForReborn = true;
      quest.started = true;
      persist();
      queueMicrotask(() => teleportToRebornNpcArea());
      return;
    }

    const nextStage = rebornQuestStages[quest.stage];
    const nextZone = zones.find(entry => entry.id === nextStage.id);
    const preservedHp = Math.max(1, Number(state.hunt.playerHp || 1));
    if (nextZone) {
      teleportToRebornStage(quest.stage);
      const zoneChanged = hunt.setZone(nextZone.id, 1);
      if (!zoneChanged || !hunt.start()) {
        hunt.stop();
        log('Falha ao carregar a próxima etapa da Quest Reborn.');
        persist();
        render();
        return;
      }
      state.hunt.playerHp = Math.min(
        preservedHp,
        Number(state.hunt.playerMaxHp || preservedHp)
      );
      log(`${stage.name} derrotado. Próximo: ${nextStage.name}.`);
    }
    persist();
    render();
  }

  function handleProgressionQuestGuardDefeat({zoneId}) {
    const zone = zones.find(entry => entry.id === zoneId);
    if (zone?.questType !== 'progression') return;
    const progress = ensureProgressionQuestState(state);
    if (String(progress.activeQuestId || '') !== String(zone.progressionQuestId || '')) return;
    clearProgressionQuestGuard(state, zone.progressionQuestId, Number(zone.progressionGuardIndex || 0));
    hunt?.stop?.();
    activeView='quest-expedition';
    huntChooserOpen=false;
    log(`${zone.name} derrotado. O caminho da expedição foi liberado.`);
    persist();
    render();
  }

  function handleQuestEnemyDefeated(info) {
    handleRebornBossDefeat(info);
    handleProgressionQuestGuardDefeat(info);
  }

  function performReborn(requestedPath = null) {
    const quest = ensureRebornQuestState();
    const level = Number(state.profile.level || 1);
    if (!quest.readyForReborn || quest.completed) {
      log('Conclua a Quest Reborn antes de rebornar.');
      return false;
    }
    if (level < rebornQuest.minimumLevel || level > rebornQuest.maximumLevel) {
      log(`Apenas level ${rebornQuest.minimumLevel} até ${rebornQuest.maximumLevel} podem rebornar.`);
      return false;
    }

    const char = characters[state.profile.characterId];
    const choices = rebornChoicesFor(state,char,rebornVocationMap);
    const available = choices.filter(choice => choice.available && choice.entryForm);
    if (!available.length) {
      log('Você precisa estar na última transformação Normal da sua vocação para rebornar.');
      return false;
    }

    const chosen = requestedPath
      ? available.find(choice => choice.path === requestedPath)
      : available.length === 1 ? available[0] : null;
    if (!chosen) {
      log('Escolha Reborn ou Super Reborn. A escolha é permanente neste personagem.');
      return false;
    }

    const current = currentTransformationForm(state,char);
    const currentVocation = Number(
      state.profile.vocationSourceId || current?.vocationId || 0
    );
    const rebornForm = chosen.entryForm;

    socket?.sendGameAction('reborn',{path:chosen.path});
    state.profile.level = 1;
    state.profile.xp = 0;
    state.profile.vocationSourceId = Number(rebornForm.vocationId || 0);
    state.profile.formId = rebornForm.id;
    state.profile.rebornPath = chosen.path;
    state.profile.rebornCount = Math.max(1,Number(state.profile.rebornCount || 0) + 1);
    state.profile.hp = null;
    state.profile.ki = null;
    state.questStorages[rebornQuest.storageId] = rebornQuest.completedStorageValue;
    quest.completed = true;
    quest.readyForReborn = false;
    quest.started = false;
    if (!state.completedQuests.includes(rebornQuest.id)) {
      state.completedQuests.push(rebornQuest.id);
    }
    rebornNpcOpen = false;
    resetToEarth(state);
    if (socket?.connected) socket.send({type:'teleport-home'});
    persist();
    syncMultiplayerAppearance();
    log(`${chosen.label} concluído. Vocação ${currentVocation} → ${rebornForm.vocationId}. A escolha deste caminho é permanente.`);
    render();
    return true;
  }

  function handleWorldNpcClick(npcId) {
    if (activeView !== 'world') return;
    const npc = worldNpcs.find(entry => entry.id === npcId);
    if (!npc) return;
    const distance = Math.abs((state.temple.x ?? 0) - npc.x) + Math.abs((state.temple.y ?? 0) - npc.y);
    const interactionDistance = npcId === 'reborn' ? 3 : 2;
    if ((state.temple.z ?? 7) !== npc.z || distance > interactionDistance) {
      log('Chegue mais perto para interagir.');
      return;
    }
    if (npcId === 'bulma') {
      // A loja completa so pode ser aberta pela Bulma no mapa. O servidor
      // continua validando a proximidade em cada compra/venda.
      vendorOpen = false;
      npcShopOpen = true;
      render();
      return;
    }
    if (npcId === 'depot' || npcId.startsWith('depot-')) {
      openDepotContainerId = state.depotContainerId;
      render();
    }
    if (npcId === 'reborn') {
      const quest = ensureRebornQuestState();
      if (quest.completed) {
        log('Desculpe, mas você já é Reborn.');
        return;
      }
      if (!quest.readyForReborn) {
        log('Derrote todos os bosses da Quest Reborn primeiro.');
        return;
      }
      rebornNpcOpen = true;
      render();
    }
  }


  function nearWorldNpc(npcMatcher, maxDistance = 2) {
    return worldNpcs.some(npc => {
      if (!npcMatcher(npc)) return false;
      if (Number(state.temple?.z ?? 7) !== Number(npc.z)) return false;
      const distance = Math.abs(Number(state.temple?.x || 0) - Number(npc.x || 0))
        + Math.abs(Number(state.temple?.y || 0) - Number(npc.y || 0));
      return distance <= maxDistance;
    });
  }

  // Loja/Depot são interfaces de proximidade. Ao sair do alcance elas fecham
  // automaticamente, inclusive quando a posição chega pelo servidor.
  function closeDistanceBoundWorldPanels() {
    if (activeView !== 'world') return false;
    let changed = false;
    const nearBulma = nearWorldNpc(npc => npc.id === 'bulma', 2);
    if ((npcShopOpen || vendorOpen) && !nearBulma) {
      npcShopOpen = false;
      vendorOpen = false;
      changed = true;
    }
    const nearDepot = nearWorldNpc(
      npc => npc.id === 'depot' || String(npc.id || '').startsWith('depot-'),
      2
    );
    if (openDepotContainerId && !nearDepot) {
      openDepotContainerId = null;
      changed = true;
    }
    return changed;
  }

  Promise.all([
    fetch('./generated/maps/absolute-temple.json').then(r => r.json()),
    loadWebAssetStatus(),
    worldMapLoader.initialize(),
    fetch('./generated/asset-registry/items.json').then(r => r.json())
  ]).then(async ([map,status,loader,itemAssets]) => {
    worldItemRegistry = new Map();
    for (const entry of itemAssets) for (const serverId of entry.serverIds || []) worldItemRegistry.set(Number(serverId), entry);
    earthMap=map; assetStatus=status;
    if(status.ok){
      const manifest=await loadWebManifest();
      const region=manifest.regions?.find(r=>r.id==='earth-pz') || manifest.regions?.[0];
      webRegionImage=region?.image ? `./${region.image}` : null;
      webRegionCenter=region?.center || webRegionCenter;
    }
    render();
  }).catch(error=>{assetStatus={ok:false,error:error.message};render();});

  const socket = new SocketClient({
    onPresence(players) {
      presence = players.filter(p => p.profileId !== state.profile.id);
      mapRenderer?.setOthers(worldPresencePlayers());
      updateOnline();
    },
    onChat(message) {
      if(message?.id&&state.chat.some(entry=>String(entry.id)===String(message.id)))return;
      state.chat.push({...message,system:false,channel:'default'});
      state.chat = state.chat.slice(-120);
      persistChatHistory();
      renderChatOnly();
    },
    onServerLog(message) {
      state.chat.push({
        id:crypto.randomUUID?.() || Date.now(),
        author:message.channel === 'loot' ? 'Loot' : 'Servidor',
        text:String(message.text || ''),
        at:Number(message.at || Date.now()),
        system:true,
        channel:message.channel === 'loot' ? 'loot' : 'server'
      });
      state.chat=state.chat.slice(-120);
      persistChatHistory();
      renderChatOnly();
    },
    onAdminMessage(message) {
      const text=String(message.text || '').slice(0,220);
      if(!text)return;
      state.chat.push({
        id:crypto.randomUUID?.() || Date.now(),author:'ADM',text,
        at:Number(message.at || Date.now()),system:true,channel:'server'
      });
      state.chat=state.chat.slice(-120);
      persistChatHistory();
      const old=document.querySelector('.admin-center-message');
      old?.remove();
      const banner=document.createElement('div');
      banner.className='admin-center-message';
      banner.textContent=text;
      document.body.appendChild(banner);
      setTimeout(()=>banner.remove(),6500);
      renderChatOnly();
    },
    onPartyState(party) {
      partyState=party;partyMessage='';
      if(!party?.activeContent)partyTankStatus=null;
      if(party?.activeContent?.type==='expedition'){activeView='quest-expedition';huntChooserOpen=false;}
      else if(party?.activeContent){activeView='hunt';huntChooserOpen=false;}
      else if(activeView==='quest-expedition')activeView='world';
      if(partyPanelOpen||party?.activeContent||activeView==='quest-expedition')render();
    },
    onPartyInvite(invite) {
      partyInvite=invite;render();
    },
    onPartyEvent(message) {
      partyMessage=String(message.message||'');
      if(message.event==='tank-status'){
        partyTankStatus={tankId:String(message.tankId||''),tankName:String(message.tankName||'Tank'),hp:Number(message.hp||0),maxHp:Number(message.maxHp||1),hpPercent:Number(message.hpPercent||0)};
        if(activeView==='hunt')render();
        return;
      }
      if(message.event==='tank-change')partyTankStatus={...(partyTankStatus||{}),tankId:String(message.tankId||''),tankName:String(message.tankName||'Tank')};
      if(message.event==='boss-complete'){partyTankStatus=null;activeView='world';huntContentTab='bosses';huntChooserOpen=true;pendingHuntZoneId=null;}
      if(message.event==='boss-timeout'){partyTankStatus=null;activeView='world';huntContentTab='bosses';huntChooserOpen=true;pendingHuntZoneId=null;resetToEarth(state);}
      if(message.event==='progression-complete'){partyTankStatus=null;activeView='world';huntContentTab='quests';huntChooserOpen=true;}
      if(message.event==='progression-timeout'){partyTankStatus=null;activeView='world';huntContentTab='quests';huntChooserOpen=true;resetToEarth(state);}
      log(partyMessage||'Atualização da Party.');
      render();
    },
    onPartyResult(message) {
      partyMessage=String(message.message||'');
      if(message.message)log(message.message);
      render();
    },
    onGuildBossInvite(invite) {
      guildBossInvite=invite;guildBossEventMessage='';render();
    },
    onGuildBossEvent(message) {
      guildBossEventMessage=String(message.message||'');
      if(message.event==='accepted'){
        guildBossAcceptedCountdown={
          runId:String(message.runId||guildBossInvite?.runId||''),
          startsAt:Number(message.startsAt||new Date(guildBossInvite?.startsAt||Date.now()).getTime()),
          bossType:String(message.bossType||guildBossInvite?.bossType||'daishinkan'),
          bossName:String(message.bossName||guildBossInvite?.bossName||'Boss da Guild')
        };
        guildBossInvite=null;
      }
      if(message.event==='started'){
        guildBossInvite=null;guildBossAcceptedCountdown=null;
        guildBossArenaParticipants=Array.isArray(message.participantProfiles)?message.participantProfiles:[];
        guildBossFightDeadlineAt=Number(message.deadlineAt||Date.now()+5*60*1000);
        activeView='hunt';huntChooserOpen=false;pendingHuntZoneId=null;
      }
      if(message.event==='member-down'&&message.downCharacterId){
        guildBossArenaParticipants=guildBossArenaParticipants.filter(p=>String(p.profileId)!==String(message.downCharacterId));
      }
      if(message.event==='tank'){guildBossTankStatus={tankId:String(message.tankId||''),tankName:String(message.tankName||'Tank'),hp:Number(message.hp||0),maxHp:Math.max(1,Number(message.maxHp||1)),hpPercent:Number(message.hpPercent||0)};}
      if(message.event==='taunt'&&String(message.tankId||'')===String(state.profile.id||'')){guildBossTauntCooldownUntil=Number(message.cooldownEndsAt||Date.now()+10000);}
      if(message.event==='taunt-result'&&message.ok===false&&message.cooldownEndsAt)guildBossTauntCooldownUntil=Number(message.cooldownEndsAt);
      if(['won','lost','eliminated','missed','entry-failed'].includes(String(message.event||''))){
        if(message.event!=='missed')activeView='world';
        guildBossInvite=null;guildBossAcceptedCountdown=null;guildBossArenaParticipants=[];guildBossTankStatus=null;guildBossFightDeadlineAt=0;guildData=null;
        if(guildOpen)loadGuildData(true);
      }
      if(message.message)log(message.message);
      render();
    },
    onCharacterProfile(message){
      if(!message?.ok){tradeMessage=String(message?.message||'Não foi possível abrir o perfil.');render();return;}
      characterProfileData=message.profile||null;characterProfileOpen=true;profileTab='profile';playerContextTarget=null;render();
    },
    onTradeInvite(invite){tradeInvite=invite;tradeMessage='';render();},
    onTradeState(next){tradeState=next;tradeInvite=null;tradeMessage='';playerContextTarget=null;render();},
    onTradeEvent(message){
      tradeMessage=String(message?.message||'');
      if(['completed','cancelled','declined'].includes(String(message?.event||''))){tradeState=null;tradeInvite=null;}
      if(message?.message)log(message.message);
      render();
    },
    onPvpInvite(invite){
      if(pvpState?.id)return;
      pvpInvite=invite;pvpMessage='';pvpLastResult=null;render();
    },
    onPvpState(next,serverTime){
      if(!next){pvpState=null;if(activeView==='pvp')render();return;}
      const offset=Date.now()-Number(serverTime||next.serverTime||Date.now());
      const duel=structuredClone(next);
      duel.startsAt=Number(duel.startsAt||0)+offset;
      duel.serverTime=Date.now();
      for(const player of duel.players||[]){
        player.cooldowns=Object.fromEntries(Object.entries(player.cooldowns||{}).map(([spellId,readyAt])=>[
          spellId,Number(readyAt||0)>0?Number(readyAt||0)+offset:0
        ]));
        player.basicAttackReadyAt=Number(player.basicAttackReadyAt||0)>0?Number(player.basicAttackReadyAt||0)+offset:0;
        player.buffs=(player.buffs||[]).map(buff=>({...buff,expiresAt:Number(buff.expiresAt||0)+offset}));
      }
      pvpState=duel;pvpInvite=null;pvpLastResult=null;activeView='pvp';render();
    },
    onPvpEvent(message){
      pvpMessage=String(message?.message||'');
      if(message?.event==='expired'||message?.event==='declined')pvpInvite=null;
      if(message?.event==='error'&&!pvpState){activeView='pvp';pvpInvite=null;}
      if(message?.message && !['hit','damaged'].includes(String(message.event||'')))log(`PvP: ${message.message}`);
      if(activeView==='pvp'||pvpInvite||message?.event==='error')render();
    },
    onPvpResult(message){
      pvpInvite=null;pvpState=null;pvpLastResult=message||null;
      pvpMessage=String(message?.reason||'Duelo PvP encerrado.');
      activeView='pvp';
      if(pvpMessage)log(`PvP: ${pvpMessage}`);
      render();
    },
    onSocialStatus(status) {
      // Multiplayer da cidade: só muda o indicador, nunca a hunt/training.
      networkStatus = status;
      updateOnline();
    },
    onStatus(status) {
      const previous=networkStatus;
      networkStatus = status;
      if(status!=='online'){
        // V21.25.7: nunca simula progresso local quando a conexao cai. O
        // servidor assume Hunt/Training em farming de protecao por ate 1h.
        if(state.training?.running)state.training.running=false;
        if(previous==='online'&&(state.hunt?.running||activeView==='hunt'||activeView==='training')){
          log('Conexão perdida. Farming de proteção ativo no servidor por até 1 hora. Reconectando...');
        }
      }
      if(status!=='online'&&pvpState){pvpState=null;pvpMessage='Conexão perdida. O duelo PvP foi encerrado como abandono.';}
      updateOnline();
    },
    onGroundLoot(items) {
      sharedGroundLoot = items;
      mapRenderer?.setGroundItems(sharedGroundLoot);
    },
    onGroundPickup(message) {
      pendingGroundPickupId = null;
      if (!message.ok) {
        if (message.reason === 'distance') log('Chegue mais perto para pegar o item.');
        if (message.reason === 'full') log('Backpack cheia. O item permaneceu no chão.');
        return;
      }
      const item = message.item;
      // Na V20.47 o item ja foi inserido no inventario autoritativo pelo servidor.
      log(`${item.name || item.itemId} foi recolhido do chão.`);
      updateDynamicPanels();
    },
    onGroundDrop(message) {
      if(!message?.ok && message?.reason==='blocked')log(message.message||'Existe uma parede impedindo jogar o item nesse SQM.');
    },
    onAuthoritativeState(snapshot) {
      applyAuthoritativeState(snapshot);
    },
    onAuthorityEvent(message) {
      if (message.event === 'protection-farming-resumed') {
        const activity=String(message.activity||'');
        if(activity==='hunt')activeView='hunt';
        else if(activity==='training')activeView='training';
        if(message.message)log(message.message);
        render();
        return;
      }
      if (message.event === 'death') {
        activeView='world';
        huntChooserOpen=false;
        resetToEarth(state);
        render();
        return;
      }
      if (message.event === 'reborn-stage') {
        const stage=Math.max(0,Number(message.stage||0));
        state.rebornQuest ||= {};
        state.rebornQuest.stage=stage;
        teleportToRebornStage(stage);
        const next=rebornQuestStages[stage];
        const nextZone=zones.find(entry=>entry.id===next?.id);
        if(nextZone){hunt.setZone(nextZone.id,1);hunt.start();activeView='hunt';}
        render();
        return;
      }
      if (message.event === 'reborn-ready') {
        state.rebornQuest ||= {};
        state.rebornQuest.readyForReborn=true;
        teleportToRebornNpcArea();
        return;
      }
      if (message.event === 'boss-complete') {
        log(`${message.monsterName||'Boss'} derrotado. Um novo ticket será necessário para outra tentativa.`);
        activeView='world';huntContentTab='bosses';huntChooserOpen=true;pendingHuntZoneId=null;render();return;
      }
      if (message.event === 'boss-timeout') {
        log(message.message||'O tempo de 5 minutos do Boss acabou. Você voltou ao PZ.');
        activeView='world';huntContentTab='bosses';huntChooserOpen=true;pendingHuntZoneId=null;resetToEarth(state);render();return;
      }
      if (message.event === 'progression-guard-cleared') {
        activeView='quest-expedition';huntChooserOpen=false;render();return;
      }
      if (message.event === 'progression-complete') {
        log(`${message.rewardName||'Recompensa'} recebida pela Quest.`);
        activeView='world';huntContentTab='quests';huntChooserOpen=true;render();return;
      }
      if (message.event === 'progression-timeout') {
        log(message.message||'O tempo de 5 minutos da Quest acabou. Você voltou ao PZ e deverá recomeçar.');
        activeView='world';huntContentTab='quests';huntChooserOpen=true;resetToEarth(state);render();return;
      }
    },
    onActionResult(message) {
      if(message.ok&&message.action==='progression-quest-start'){activeView='quest-expedition';huntChooserOpen=false;render();}
      if(message.ok&&message.action==='progression-quest-move'&&message.phase==='guard'){activeView='hunt';huntChooserOpen=false;render();}
      if(message.ok&&message.action==='progression-quest-stop'){activeView='world';render();}
      if(['friend-add','friend-remove'].includes(message.action)){
        friendsMessage={ok:Boolean(message.ok),text:String(message.message||'')};
        if(friendsPanelOpen)render();
      }
      if(message.action==='offline-stop'){
        if(message.ok){
          activeView='world';huntChooserOpen=false;offlineReturnTab='summary';
        }
        render();
      }
      // The authoritative snapshot arrives before the action result, so these
      // overlays can redraw immediately without requiring close/reopen.
      if(['bestiary-upgrade','boss-bestiary-upgrade'].includes(message.action)&&bestiaryOpen)render();
      if(message.action==='mail-claim'&&mailOpen)render();
      if(['game-pass-mission-claim','game-pass-tier-claim'].includes(message.action)&&gamePassOpen)render();
      if (message.message) log(message.ok ? message.message : `Servidor: ${message.message}`);
    },
    onPosition(rawPosition) {
      const reconciled = reconcileWorldPosition(rawPosition);
      if (reconciled.ignored || !reconciled.position) return;
      state.temple = { ...state.temple, ...reconciled.position };
      if (handleRebornWorldStep(state.temple)) return;
      if (closeDistanceBoundWorldPanels()) {
        persist();
        render();
        return;
      }
      const char = characters[state.profile.characterId];
      mapRenderer?.setPlayer({
        ...state.temple,
        ...reconciled.renderPosition,
        name: state.profile.name,
        sprite: characterPortrait(char),
        outfitId: characterOutfitId(char),
        direction: reconciled.renderPosition?.direction ?? state.temple.direction ?? 2
      });
      persist();
    }
  });

  let hunt = null;
  const localHunt = createHuntEngine({
    state,
    // Offline mode keeps the browser simulation. Online mode is server-owned;
    // running both loops caused monster rollback/jitter every server snapshot.
    // V21.25.7: contas online nunca evoluem pelo loop local. Se a internet
    // cair, somente o runtime autoritativo da VPS pode continuar a atividade.
    shouldTick: () => true, /* build estatica: sem servidor, o loop do navegador volta a ser o unico */
    onUpdate: () => { persist(); updateDynamicPanels({containersChanged:true}); },
    onLog: log,
    onDeath: () => {
      activeView = 'world';
      huntChooserOpen = false;
      resetToEarth(state);
      if (socket?.connected) socket.send({type:'teleport-home'});
      persist();
      render();
    },
    onEnemyDefeated:handleQuestEnemyDefeated,
    onBossTimeout:()=>{activeView='world';huntContentTab='bosses';huntChooserOpen=true;pendingHuntZoneId=null;resetToEarth(state);persist();render();}
  });
  hunt = new Proxy(localHunt, {
    get(target, prop) {
      const original = target[prop];
      if (typeof original !== 'function') return original;
      if (prop === 'setZone') return (zoneId,lureCount) => { const r=original(zoneId,lureCount); if(r) socket?.sendGameAction('hunt-zone',{zoneId,lureCount}); return r; };
      if (prop === 'start') return (...args) => { const r=original(...args); if(r) socket?.sendGameAction('hunt-start'); return r; };
      if (prop === 'stop') return (...args) => { const r=original(...args); socket?.sendGameAction('hunt-stop'); return r; };
      if (prop === 'setLureCount') return value => { const r=original(value); socket?.sendGameAction('hunt-lure',{value:r}); return r; };
      if (prop === 'castSpell') return spell => { const r=original(spell); if(r?.ok) socket?.sendGameAction('cast-spell',{spellId:spell?.id}); return r; };
      if (prop === 'useConsumable') return itemId => { const r=original(itemId); if(r?.ok) socket?.sendGameAction('use-consumable',{itemId}); return r; };
      if (prop === 'lootCorpse') return corpseId => { const r=original(corpseId); if(r) socket?.sendGameAction('loot-corpses'); return r; };
      if (prop === 'dropItemOnHunt') return (itemId,quantity=1) => { const r=original(itemId,quantity); if(r) socket?.sendGameAction('drop-hunt-item',{itemId,quantity}); return r; };
      return original.bind(target);
    }
  });

  const localTraining = createTrainingEngine({
    state,
    characters,
    itemCatalog,
    onUpdate() {
      persist();
      updateDynamicPanels({containersChanged:true});
    },
    onLog:log
  });
  const training = new Proxy(localTraining, {
    get(target, prop) {
      const original=target[prop];
      if(typeof original!=='function')return original;
      if(prop==='start')return roomId=>{const r=original(roomId);if(r)socket?.sendGameAction('training-start',{roomId});return r;};
      if(prop==='stop')return (...args)=>{const r=original(...args);socket?.sendGameAction('training-stop');return r;};
      return original.bind(target);
    }
  });

  // A page reload always starts back on the 'world' view (see
  // `activeView` above), but state.hunt/state.training.running is
  // whatever was persisted right before the reload — so without this,
  // the character would appear to be standing in the PZ while the hunt
  // or training tick loop kept silently running in the background
  // (still fighting, still gaining/losing HP) underneath that view.
  // Refreshing the page should behave like actually leaving the
  // activity, not like tabbing away from it.
  if (state.hunt?.running) {
    hunt.stop();
    resetToEarth(state);
    restoreInPz();
  }
  if (state.training?.running) {
    training.stop();
  }

  state.characterDefinition = characters[state.profile.characterId];
  // V22.4.4 — cadeias de reserva de sprite. Algumas spritesheets do pacote
  // de arte vieram vazias; com isso, a forma sem arte desenha a forma
  // anterior da própria cadeia em vez de deixar o personagem invisível.
  registerFormChains(characters);
  const spellController = createSpellController({
    state,
    onCast(spell) {
      return hunt.castSpell?.(spell);
    },
    onLog:log
  });

  function spellCategory(spell) {
    if (!spell) return 'status';

    if (spell.runtimeKind === 'damage' && spell.aggressive) {
      return 'attack';
    }

    if (spell.id === 'guardian-taunt') return 'aggro';

    if (spell.runtimeKind === 'healing') {
      return 'healing';
    }

    const name = String(spell.name || '').toLowerCase();
    const conditionTypes = new Set(
      (spell.conditions || []).map(condition => condition.type)
    );

    if (
      conditionTypes.has('CONDITION_HASTE') ||
      /speed|haste|dash|agility/.test(name)
    ) {
      return 'speed';
    }

    // Mystic Defense and defensive techniques are Status, never Buff.
    if (
      /mystic defense|defense|barrier|shield|resist|protection/.test(name)
    ) {
      return 'status';
    }

    if (
      /power|strength|rage|berserk|boost|kaioken|potential|super saiyan/.test(name)
    ) {
      return 'buff';
    }

    return 'status';
  }

  function spellAllowedForCharacter(spell) {
    if (!spell || spell.kind !== 'instant') return false;

    const vocationId = Number(state.profile.vocationSourceId || 0);
    const character = state.characterDefinition;
    const allowedVocationIds = new Set([
      vocationId,
      Number(character?.vocationSourceId || 0),
      ...(character?.forms || []).map(form => Number(form.vocationId || 0)),
      ...(character?.legacyVocationIds || []).map(Number)
    ]);

    return (
      !spell.vocationIds?.length ||
      spell.vocationIds.some(id => allowedVocationIds.has(Number(id)))
    );
  }

  function spellLockInfo(spell) {
    if (!spell) return {locked:true,label:'',title:'Spell indisponível'};
    if (spell.premium && Number(state.profile.vipUntil || 0) <= Date.now()) {
      return {
        locked:true,
        label:'VIP',
        title:`${spell.name} — exclusiva para jogadores VIP`
      };
    }
    if (Number(state.profile.level || 1) < Number(spell.level || 1)) {
      return {
        locked:true,
        label:`Lv ${spell.level}`,
        title:`${spell.name} — Libera no level ${spell.level}`
      };
    }
    return {locked:false,label:'',title:`${spell.name} — level ${spell.level}`};
  }

  function spellKiCostLabel(spell) {
    const percent=Number(spell?.kiCostPercent ?? spell?.manaPercent ?? spell?.manapercent ?? 0);
    if(spell?.kiCostMode==='percent' && percent>0){
      return `${percent.toLocaleString('pt-BR',{maximumFractionDigits:1})}% Ki máximo`;
    }
    return `${Math.max(0,Number(spell?.kiCost ?? spell?.mana ?? 0)).toLocaleString('pt-BR')} Ki`;
  }

  function spellUnlocked(spell) {
    return Boolean(spell) && !spellLockInfo(spell).locked;
  }

  function allSpellsForCategory(category) {
    return spells
      .filter(spell =>
        spellAllowedForCharacter(spell) &&
        spellCategory(spell) === category &&
        !/power\s*down/i.test(String(spell.name || ''))
      )
      .sort((a,b) =>
        Number(a.level || 1) - Number(b.level || 1) ||
        String(a.name || '').localeCompare(String(b.name || ''))
      );
  }

  function spellsForCategory(category) {
    return allSpellsForCategory(category).filter(spellUnlocked);
  }

  function configuredSupportSpell(kind) {
    const id = state.settings.spellBar.support?.[kind]?.spellId;
    return allSpellsForCategory(kind).find(spell => spell.id === id) || null;
  }

  function supportSpell(kind) {
    const spell = configuredSupportSpell(kind);
    return spellUnlocked(spell) ? spell : null;
  }

  function nextLockedSpell(category, excludedIds = []) {
    const excluded = new Set(excludedIds.filter(Boolean));
    return allSpellsForCategory(category).find(spell =>
      !excluded.has(spell.id) && !spellUnlocked(spell)
    ) || null;
  }

  function lockedAttackPreviewForSlot(index) {
    const slots = state.settings.spellBar?.slots || [];
    if (slots[index]) return null;

    const emptySlots = Array.from({length:4}, (_, slotIndex) => slotIndex)
      .filter(slotIndex => !slots[slotIndex]);
    const emptyRank = emptySlots.indexOf(index);
    if (emptyRank < 0) return null;

    const configured = new Set(slots.filter(Boolean));
    const future = allSpellsForCategory('attack').filter(spell =>
      !configured.has(spell.id) && !spellUnlocked(spell)
    );
    return future[emptyRank] || null;
  }
  function castSupportSpell(kind,spellId){
    // Cooldowns de suporte agora seguem exatamente o spells.xml/Lua.
    // Storages compartilhados (ex.: Power Ups) são tratados pelo
    // spellController em vez de uma trava artificial de 5 min/60 s.
    return spellController.cast(spellId);
  }


  function initializeSpellBar() {
    const attacks = spellsForCategory('attack')
      .sort((a,b) => a.level - b.level);

    for (let index = 0; index < 4; index += 1) {
      const configuredId = state.settings.spellBar.slots[index];
      const configuredExists = attacks.some(spell =>
        spell.id === configuredId
      );
      if (!configuredExists) {
        state.settings.spellBar.slots[index] =
          attacks[index]?.id || null;
      }
    }
  }

  state.settings.spellBar.auto = Array.from(
    {length:4},
    (_, index) => state.settings.spellBar.auto?.[index] === true
  );
  state.settings.spellBar.enabled = Array.from(
    {length:4},
    (_, index) => state.settings.spellBar.enabled?.[index] !== false
  );
  state.settings.spellBar.minTargets = Array.from(
    {length:4},
    (_,index) => Math.max(
      1,
      Math.min(
        5,
        Number(state.settings.spellBar.minTargets?.[index] || 1)
      )
    )
  );

  state.settings.spellBar.support ||= {
    buff:{spellId:null,auto:false},
    speed:{spellId:null,auto:false},
    healing:{spellId:null,auto:false,threshold:75},
    aggro:{spellId:'guardian-taunt',auto:false}
  };
  for (const kind of ['buff','speed','healing','aggro']) {
    state.settings.spellBar.support[kind] ||= {
      spellId:kind==='aggro'?'guardian-taunt':null,
      auto:false
    };
    if(kind==='aggro'){state.settings.spellBar.support[kind].spellId='guardian-taunt';state.settings.spellBar.support[kind].auto=false;}
  }

  initializeSpellBar();

  let lastAutoSpellCheck = 0;

  const spellCooldownVisualInterval = setInterval(() => {
    updateSpellCooldowns();
  }, 100);

  const autoSpellInterval = setInterval(() => {
    if (activeView !== 'hunt' || !state.hunt.running) return;
    // Multiplayer auto-cast is authoritative on the Node server from V20.68.
    // Keeping browser timers out of the path prevents background-tab throttle
    // from disabling healing/rotation after Alt+Tab.
    if (socket?.connected) return;

    const now = Date.now();
    if (now - lastAutoSpellCheck < 250) return;
    lastAutoSpellCheck = now;

    const available = spellController.available();
    const slots = state.settings.spellBar?.slots || [];
    const enabled = state.settings.spellBar?.enabled || [];
    const automatic = state.settings.spellBar?.auto || [];

    const livingCount = state.hunt.enemies.filter(enemy =>
      enemy.alive && enemy.hp > 0
    ).length;

    const rotationCandidates=slots
      .map((spellId,index)=>({
        spellId,
        index,
        enabled:enabled[index]!==false,
        automatic:automatic[index]===true,
        minimumTargets:Math.max(
          1,
          Number(state.settings.spellBar.minTargets[index]||1)
        )
      }))
      .filter(candidate =>
        candidate.spellId &&
        candidate.enabled &&
        candidate.automatic &&
        livingCount>=candidate.minimumTargets
      )
      .sort((a,b) =>
        b.minimumTargets-a.minimumTargets ||
        a.index-b.index
      );

    for(const candidate of rotationCandidates){
      const spell=available.find(entry =>
        entry.id===candidate.spellId
      );
      if(!spell?.aggressive)continue;

      const result=spellController.cast(candidate.spellId);
      if(result.ok){
        persist();
        updateDynamicPanels();
        break;
      }
    }

    const hpPercent = state.hunt.playerMaxHp > 0
      ? state.hunt.playerHp / state.hunt.playerMaxHp * 100
      : 100;

    for (const kind of ['healing','buff','speed']) {
      const config = state.settings.spellBar.support?.[kind];
      if (!config?.auto || !config.spellId) continue;
      if (
        kind === 'healing' &&
        hpPercent >
          Number(
            state.settings.spellBar.support.healing.threshold || 75
          )
      ) continue;

      const spell = supportSpell(kind);
      if (!spell) continue;
      const result = castSupportSpell(kind,spell.id);
      if (result.ok) {
        persist();
        updateDynamicPanels();
      }
    }
  }, 250);






  {
    const onlineChar = characters[state.profile.characterId];
    // Só o que os outros jogadores precisam ver: o profile completo (mail,
    // amigos, banco...) não sai do navegador.
    socket.connect({
      id:state.profile.id,
      name:state.profile.name,
      level:Number(state.profile.level || 1),
      characterId:state.profile.characterId,
      formId:state.profile.formId || '',
      sprite:characterPortrait(onlineChar),
      outfitId:characterOutfitId(onlineChar),
      position:{...state.temple}
    });
  }

  function syncMultiplayerAppearance() {
    if (!socket) return;
    const char = characters[state.profile.characterId];
    socket.sendAppearance({
      characterId:state.profile.characterId,
      formId:state.profile.formId || '',
      vocationSourceId:Number(state.profile.vocationSourceId || 0),
      level:Number(state.profile.level || 1),
      sprite:characterPortrait(char),
      outfitId:characterOutfitId(char)
    });
  }

  function scheduleAuthorityClientSync() {
    if (!socket?.connected || authoritySyncTimer) return;
    authoritySyncTimer=setTimeout(() => {
      authoritySyncTimer=null;
      if(!socket?.connected)return;
      const layout={
        containers:state.containers,
        equipment:state.equipment,
        depotContainerId:state.depotContainerId
      };
      const layoutSignature=JSON.stringify(layout);
      if(layoutSignature!==lastAuthorityLayoutSignature){
        lastAuthorityLayoutSignature=layoutSignature;
        socket.sendClientLayout(structuredClone(layout));
      }
      const preferences={
        settings:state.settings,
        ignoredLoot:state.hunt?.lootFilter?.ignored||[],
        favoriteZoneIds:state.hunt?.favoriteZoneIds||[],
        // V21.25.9: o historico visual do chat viaja separado do progresso
        // autoritativo. Isso preserva autor/canal/horario sem depender de um
        // save completo do personagem a cada mensagem.
        chat:(state.chat||[]).slice(-120)
      };
      const prefSignature=JSON.stringify(preferences);
      if(prefSignature!==lastAuthorityPreferencesSignature){
        lastAuthorityPreferencesSignature=prefSignature;
        socket.sendClientPreferences(structuredClone(preferences));
      }
    },250);
  }

  function persist() {
    saveState(state);
    onSaveCharacter(state);
    scheduleAuthorityClientSync();
  }

  function persistChatHistory() {
    // O servidor guarda o historico como preferencia sanitizada. Nao envia um
    // snapshot inteiro do personagem apenas porque uma mensagem chegou.
    saveState(state);
    scheduleAuthorityClientSync();
  }

  function log(text, channel='server') {
    state.chat.push({
      id: crypto.randomUUID?.() || Date.now(),
      author: channel === 'default' ? state.profile.name : 'Servidor',
      text,
      at: Date.now(),
      system: channel === 'server',
      channel
    });
    state.chat = state.chat.slice(-80);
    persist();
  }

  function restoreInPz() {
    const char = characters[state.profile.characterId];
    const stats = totalStats(state, itemCatalog);
    const resources = maxResources(state, char, stats);
    const maxHp = Math.max(1, Number(resources.maxHp || 1));
    const maxKi = Math.max(1, Number(resources.maxKi || 1));

    state.profile.maxHp = maxHp;
    state.profile.maxKi = maxKi;
    state.profile.hp = maxHp;
    state.profile.ki = maxKi;
    state.hunt.playerMaxHp = maxHp;
    state.hunt.playerHp = maxHp;
  }

  const pzRecoveryInterval = setInterval(() => {
    if (activeView !== 'world') return;
    // Multiplayer resources are server-authoritative. Mutating HP/KI locally
    // every 500 ms fights the incoming snapshot and makes the bars oscillate.
    if (socket?.connected) return;
    const oldHp = Number(state.profile.hp || 0);
    const oldKi = Number(state.profile.ki || 0);
    restoreInPz();
    if (
      oldHp !== state.profile.hp ||
      oldKi !== state.profile.ki
    ) {
      persist();
      updateDynamicPanels();
    }
  }, 500);

  function returnToPz(){
    if(['expedition','quest-guard'].includes(String(partyState?.activeContent?.type||''))){
      if(partyState?.isLeader)socket.sendPartyAction('stop-expedition');
      else socket.sendPartyAction('leave');
    }
    hunt.stop();
    training.stop();
    resetToEarth(state);
    restoreInPz();
    rebornNpcOpen=false;
    huntChooserOpen=false;
    trainingChooserOpen=false;
    pendingHuntZoneId=null;
    pendingLureCount=null;
    activeView='world';
    if(socket?.connected)socket.send({type:'teleport-home'});
    persist();
  }

  function setView(view) {
    if(view==='market'){marketOpen=true;loadMarketData();render();return;}
    if(view==='vip'){vipStoreOpen=true;render();return;}
    if(view==='pvp'){
      if(pvpState){activeView='pvp';render();return;}
      if(networkStatus!=='online'){
        pvpMessage='O PvP exige conexão com o servidor.';log(pvpMessage);return;
      }
      if(activeView!=='world'){
        pvpMessage='Volte ao PZ antes de entrar na Arena PvP.';log(pvpMessage);return;
      }
      activeView='pvp';pvpLastResult=null;socket.sendPvpAction('status');render();return;
    }
    if(view==='world'&&pvpState){
      pvpMessage='Abandone o duelo PvP antes de voltar ao PZ.';render();return;
    }
    if(view==='world')returnToPz();
    if (view === 'npcs' && activeView !== 'world') return;
    activeView = view;
    render();
  }

  function openTrainingChooser() {
    hunt.stop();
    training.stop();
    pendingTrainingRoomId =
      state.training?.roomId || trainingRooms[0].id;
    trainingChooserOpen = true;
    render();
  }

  function confirmTraining() {
    const room = trainingRooms.find(entry =>
      entry.id === pendingTrainingRoomId
    );
    if (!room) return;
    trainingChooserOpen = false;
    activeView = 'training';
    training.start(room.id);
    render();
  }

  function openHuntChooser() {
    // V20.57 — abrir a lista nunca interrompe a atividade atual. Em especial,
    // durante uma Hunt os monstros continuam sendo simulados pelo servidor
    // enquanto o jogador olha/fecha a janela de seleção. A troca só acontece
    // quando outra Hunt é confirmada.
    // Nothing pre-selected: the detail preview only appears once the
    // player actually clicks a hunt, instead of always rendering (and
    // partially wasting screen space and image loads on) whichever zone
    // happened to be last visited.
    pendingHuntZoneId = null;
    pendingLureCount = null;
    huntChooserOpen = true;
    render();
  }

  const HUNT_SWITCH_COOLDOWN_MS = 30000;

  function huntSwitchRemainingMs() {
    const last = Number(state.hunt?.lastSwitchAt || 0);
    return Math.max(0, HUNT_SWITCH_COOLDOWN_MS - (Date.now() - last));
  }

  function isSwitchingToDifferentHunt(zone) {
    return Boolean(
      state.hunt?.running &&
      zone &&
      String(zone.id) !== String(state.hunt?.zoneId || '')
    );
  }

  function confirmHunt() {
    const selected = zones.find(
      zone => zone.id === pendingHuntZoneId
    );
    if (!selected) return;
    if (!hasVipAccess(selected)) {
      log('Apenas jogadores VIP podem entrar neste conteúdo.');
      return;
    }
    const partyContent=selected.questType==='reborn'||selected.contentType==='boss';
    if(partyState){
      if(!partyContent){log('Enquanto estiver em Party, Hunts comuns não podem ser iniciadas.');return;}
      if(!partyState.isLeader){log('Somente o líder da Party pode iniciar Quests ou Bosses para o grupo.');return;}
      if(selected.bossTicketItemId&&itemQuantity(state,selected.bossTicketItemId)<1){log(`O líder precisa de ${itemCatalog[selected.bossTicketItemId]?.name||'um ticket'} para iniciar este Boss.`);return;}
      socket.sendPartyAction('start-content',{zoneId:selected.id});
      huntChooserOpen=false;pendingHuntZoneId=null;pendingLureCount=null;activeView='hunt';render();return;
    }
    if(selected.bossTicketItemId&&itemQuantity(state,selected.bossTicketItemId)<1){log(`Você precisa de ${itemCatalog[selected.bossTicketItemId]?.name||'um ticket'} para iniciar este Boss.`);return;}

    // V20.35 — Quest Reborn has two separate level concepts:
    // - minEntryLevel / maximumLevel: who may enter the quest (Lv 200–1000)
    // - zone.level / difficultyLevel: Lv 1000 combat scaling used by the bosses.
    // The old generic Hunt guard compared the player against zone.level before
    // calling beginRebornQuest(), which silently blocked every Reborn entrant
    // below level 1000 even though the UI correctly allowed level 200+.
    if (selected.questType === 'reborn') {
      if (state.hunt?.running) {
        log('Pare a Hunt atual antes de entrar na Quest Reborn.');
        return;
      }
      beginRebornQuest();
      return;
    }

    if (state.profile.level < selected.level) return;

    const switching = isSwitchingToDifferentHunt(selected);
    if (switching) {
      const remaining = huntSwitchRemainingMs();
      if (remaining > 0) {
        log(`Aguarde ${Math.ceil(remaining / 1000)}s para trocar de Hunt.`);
        updateHuntSwitchButton();
        return;
      }

      // Online: o servidor faz a troca de forma atômica e mantém a Hunt atual
      // rodando até a confirmação ser aceita. Nada é parado ao abrir/fechar o menu.
      if (socket.connected) {
        socket.sendGameAction('hunt-switch', {
          zoneId:selected.id,
          lureCount:pendingLureCount
        });
        huntChooserOpen = false;
        pendingHuntZoneId = null;
        pendingLureCount = null;
        activeView = 'hunt';
        render();
        return;
      }

      // Offline mantém a mesma regra de 30s localmente.
      const changed = hunt.setZone(selected.id, pendingLureCount);
      if (!changed) return;
      state.hunt.lastSwitchAt = Date.now();
      hunt.start();
      huntChooserOpen = false;
      activeView = 'hunt';
      persist();
      render();
      return;
    }

    // Selecionar a própria Hunt atual apenas fecha o seletor; não reinicia a
    // formação nem reseta monstros. Para lure, use o seletor da barra da Hunt.
    if (state.hunt?.running && String(selected.id) === String(state.hunt?.zoneId || '')) {
      huntChooserOpen = false;
      pendingHuntZoneId = null;
      pendingLureCount = null;
      render();
      return;
    }

    huntChooserOpen = false;
    hunt.setZone(selected.id, pendingLureCount);
    activeView = 'hunt';
    const started = hunt.start();
    if (started && !socket.connected) state.hunt.lastSwitchAt = Date.now();
    render();
  }

  function updateHuntSwitchButton() {
    if (!huntChooserOpen || !state.hunt?.running) return;
    const button = root.querySelector('[data-action="confirm-hunt"]');
    if (!button) return;
    const selected = zones.find(zone => zone.id === pendingHuntZoneId);
    if (!selected || selected.questType === 'reborn') return;
    if (!hasVipAccess(selected)) {
      button.disabled = true;
      button.textContent = 'APENAS PARA VIPS';
      return;
    }
    if (state.profile.level < selected.level) {
      button.disabled = true;
      button.textContent = `REQUER LEVEL ${selected.level}`;
      return;
    }
    if (String(selected.id) === String(state.hunt.zoneId || '')) {
      button.disabled = false;
      button.textContent = 'HUNT ATUAL';
      return;
    }
    const remaining = huntSwitchRemainingMs();
    button.disabled = remaining > 0;
    button.textContent = remaining > 0
      ? `TROCAR EM ${Math.ceil(remaining / 1000)}s`
      : 'TROCAR HUNT';
  }

  setInterval(updateHuntSwitchButton, 500);
  setInterval(updateOfflineReturnDialog, 500);

  function renderStackMoveDialog(){
    if(!stackMoveDialog)return '';
    const max=Math.max(1,Number(stackMoveDialog.max||1));
    const qty=Math.max(1,Math.min(max,Number(stackMoveDialog.quantity||max)));
    const item=itemCatalog[stackMoveDialog.itemId]||{};
    return `<div class="stack-quantity-backdrop" data-stack-quantity-backdrop>
      <section class="stack-quantity-dialog" role="dialog" aria-modal="true">
        <header><div class="stack-quantity-icon">${itemVisual(item)}</div><div><small>MOVER QUANTIDADE</small><h3>${escapeHtml(item.name||stackMoveDialog.itemId)}</h3></div></header>
        <div class="stack-quantity-value"><strong data-stack-quantity-value>${qty}</strong><span>/ ${max}</span></div>
        <input type="range" min="1" max="${max}" value="${qty}" step="1" data-stack-quantity-range>
        <div class="stack-quantity-actions"><button data-stack-quantity-cancel>Cancelar</button><button class="primary" data-stack-quantity-confirm>Confirmar</button></div>
      </section>
    </div>`;
  }

  function offlineLiveReport(mode=state.hunt?.offlineMode||{}){
    const budget=Math.max(0,Number(mode.budgetSeconds||0));
    const elapsed=Math.max(0,Math.min(budget,(Date.now()-Number(mode.startedAt||Date.now()))/1000));
    const hours=elapsed/3600;
    const rates=mode.rates||{};
    return {
      elapsedSeconds:Math.floor(elapsed),
      xp:Math.floor(Math.max(0,Number(rates.xpPerHour||0))*hours*0.5),
      zeni:Math.floor(Math.max(0,Number(rates.zeniPerHour||0))*hours*0.5),
      drops:Object.entries(rates.dropsPerHour||{}).map(([key,perHour])=>({key,quantity:Math.max(0,Number(perHour||0))*hours*0.5,projected:true})).filter(row=>row.quantity>=0.01),
      remainingSeconds:Math.max(0,Math.floor(budget-elapsed))
    };
  }

  function offlineLootRows(report=state.hunt?.offlineMode?.lastReport||{},projected=false){
    return (report.drops||[]).map(drop=>{
      const [itemId,rarity='common']=String(drop.key||'').split('|');
      const item=itemCatalog[itemId]||{};
      const quantity=projected ? Number(drop.quantity||0).toFixed(Number(drop.quantity||0)>=10?0:2) : Number(drop.quantity||0).toLocaleString('pt-BR');
      return `<article class="offline-return-loot-row">${itemVisual(item)}<div><strong>${escapeHtml(item.name||itemId)}</strong><small>${escapeHtml(rarityDefinition(rarity).name)}${projected?' · estimativa':''}</small></div><b>${projected?'~':''}${quantity}x</b></article>`;
    }).join('')||`<div class="offline-return-empty">${projected?'Nenhum drop projetado ainda.':'Nenhum item foi dropado neste período.'}</div>`;
  }

  function renderOfflineReturnDialog(){
    const mode=state.hunt?.offlineMode||{};
    if(!mode.active)return '';
    const live=!mode.settled;
    const report=live?offlineLiveReport(mode):(mode.lastReport||{elapsedSeconds:0,xp:0,zeni:0,drops:[]});
    return `<div class="offline-return-backdrop">
      <section class="offline-return-dialog ${live?'offline-live':''}">
        <header><div><small>${live?'CAÇA OFFLINE EM ANDAMENTO':'CAÇA OFFLINE FINALIZADA'}</small><h2>${live?'Modo Offline ativo':'Bem-vindo de volta'}</h2></div><span>${live?`Restante: <b data-offline-live-remaining>${formatHuntDuration(report.remainingSeconds)}</b>`:'50% do rendimento calibrado'}</span></header>
        <nav><button data-offline-return-tab="summary" class="${offlineReturnTab==='summary'?'active':''}">Resumo</button><button data-offline-return-tab="loot" class="${offlineReturnTab==='loot'?'active':''}">${live?'Loot estimado':'Loot'}</button></nav>
        ${offlineReturnTab==='loot'
          ? `<div class="offline-return-loot" data-offline-live-loot>${offlineLootRows(report,live)}</div>`
          : `<div class="offline-return-summary"><article><small>Tempo caçando</small><strong data-offline-live-time>${formatHuntDuration(report.elapsedSeconds)}</strong></article><article><small>${live?'XP acumulada*':'XP recebida'}</small><strong data-offline-live-xp>${Number(report.xp||0).toLocaleString('pt-BR')}</strong></article><article><small>${live?'Zeni acumulado*':'Zeni recebido'}</small><strong data-offline-live-zeni>${Number(report.zeni||0).toLocaleString('pt-BR')}</strong></article><article><small>${live?'Drops projetados':'Drops diferentes'}</small><strong data-offline-live-drops>${Number((report.drops||[]).length)}</strong></article></div>`}
        <p>${live?'* XP, Zeni e loot são calculados em tempo real pela média do Hunt Analyser a 50%. O loot efetivo é consolidado pelo servidor ao desativar.':'Enquanto esta tela estiver aberta, o personagem continua bloqueado em Modo Offline. Confira o loot e desative para voltar a jogar.'}</p>
        <button class="offline-return-disable" data-offline-return-disable title="Desativar modo offline e voltar a jogar">Desativar modo offline e voltar ao Templo</button>
      </section>
    </div>`;
  }

  function updateOfflineReturnDialog(){
    const mode=state.hunt?.offlineMode||{};
    if(!mode.active||mode.settled)return;
    const dialog=root.querySelector('.offline-return-dialog.offline-live');
    if(!dialog)return;
    const report=offlineLiveReport(mode);
    const set=(selector,value)=>{const el=dialog.querySelector(selector);if(el)el.textContent=value;};
    set('[data-offline-live-time]',formatHuntDuration(report.elapsedSeconds));
    set('[data-offline-live-xp]',Number(report.xp||0).toLocaleString('pt-BR'));
    set('[data-offline-live-zeni]',Number(report.zeni||0).toLocaleString('pt-BR'));
    set('[data-offline-live-drops]',String((report.drops||[]).length));
    set('[data-offline-live-remaining]',formatHuntDuration(report.remainingSeconds));
    const loot=dialog.querySelector('[data-offline-live-loot]');
    if(loot&&offlineReturnTab==='loot'){loot.innerHTML=offlineLootRows(report,true);bindItemTooltipTargets(loot);}
  }


  // Multiplayer da cidade: publica posição, atividade e visual atuais. O
  // SocketClient só manda o que mudou, então rodar a cada render é barato.
  function syncSocialPresence() {
    try {
      const char = characters[state.profile.characterId];
      const activity = activeView === 'world' ? 'world' : String(activeView || 'world');
      socket.syncLocal({
        position:state.temple,
        activity,
        zoneName:activity === 'hunt' ? (zones.find(zone => zone.id === state.hunt.zoneId)?.name || '') : '',
        appearance:{
          level:Number(state.profile.level || 1),
          characterId:state.profile.characterId,
          formId:state.profile.formId || '',
          sprite:characterPortrait(char),
          outfitId:characterOutfitId(char)
        }
      });
    } catch {}
  }

  function render() {
    syncSocialPresence();
    const preservedWindowScroll = (activeView === 'npcs' || vendorOpen)
      ? {x:window.scrollX,y:window.scrollY}
      : null;

    // Preserve scroll position of any element marked data-preserve-scroll
    // across the full re-render below (root.innerHTML is rebuilt from
    // scratch every time, so scrollable panels — like the Hunt list —
    // would otherwise silently jump back to the top on every click).
    const preservedScroll = new Map();
    root.querySelectorAll('[data-preserve-scroll]').forEach(el => {
      preservedScroll.set(el.getAttribute('data-preserve-scroll'), {
        top:el.scrollTop,
        left:el.scrollLeft
      });
    });

    // Same idea for text inputs marked data-preserve-focus (e.g. the Hunt
    // search box): re-rendering on every keystroke would otherwise steal
    // focus and reset the cursor after each character typed.
    let preservedFocus = null;
    const focusedEl = root.querySelector('[data-preserve-focus]');
    if (focusedEl && document.activeElement === focusedEl) {
      preservedFocus = {
        key: focusedEl.getAttribute('data-preserve-focus'),
        selectionStart: focusedEl.selectionStart,
        selectionEnd: focusedEl.selectionEnd
      };
    }

    mapRenderer?.destroy();
    huntRenderer?.destroy();
    trainingRenderer?.destroy();
    mapRenderer = null;
    huntRenderer = null;
    trainingRenderer = null;
    const char = characters[state.profile.characterId];
    const canUseForge=forgeAvailable();
    const canUseMarket=marketAvailable();
    if(!canUseForge)forgeOpen=false;
    if(!canUseMarket)marketOpen=false;

    root.innerHTML = `
      <div class="classic-client">
        <header class="classic-titlebar">
          <div class="client-logo"><span>★</span><strong>Forgotten Lands</strong></div>
          <div class="title-actions">
            ${['world','hunt','training'].includes(activeView)
              ? `<button class="top-nav-icon-button top-character-button" data-action="switch-character"><img src="./assets/ui/v2130/swap.png" alt=""><span>Personagem</span></button>`
              : ''}
            <button class="top-nav-icon-button top-party-button ${partyState ? 'active' : ''}" data-action="open-party"><img src="./assets/ui/v2130/party.png" alt=""><span>Party${partyState?` ${partyState.members.length}`:''}</span></button>
            <button class="top-nav-icon-button top-friends-button ${friendsPanelOpen?'active':''}" data-action="open-friends"><img src="./assets/ui/v2130/friends.png" alt=""><span>Amigos</span></button>
            <button class="top-nav-icon-button top-profile-button ${characterProfileOpen&&String(characterProfileData?.id||'')===String(state.profile.id||'')?'active':''}" data-action="open-self-profile"><img src="./assets/ui/v2117/default-profile-icon.png" alt="Perfil"><span>Perfil</span></button>
            <button class="top-nav-icon-button top-mail-button ${mailOpen?'active':''}" data-action="open-mail"><img src="./assets/ui/v2124/mail.jpg" alt="Mail"><span>Mail${ensureMailbox(state.profile).length?` <b class="top-mail-count">${ensureMailbox(state.profile).length}</b>`:''}</span></button>
            <button class="top-nav-icon-button top-guild-button ${guildOpen?'active':''}" data-action="open-guild"><span class="top-guild-symbol"><img src="./assets/ui/v2180/guild.png" alt="Guild"></span><span>Guild</span></button>
            ${canUseMarket?`<button class="top-nav-icon-button top-market-button ${marketOpen ? 'active' : ''}" data-action="open-market"><img src="./assets/ui/v2130/market.png" alt=""><span>Mercado</span></button>`:''}
            <button class="top-nav-icon-button top-vip-button ${vipStoreOpen?'active':''}" data-action="open-vip"><img src="./assets/ui/v2130/vip.png" alt=""><span>Loja VIP</span></button>
            <button class="top-nav-icon-button top-daily-button ${dailyGiftOpen?'active':''}" data-action="open-daily"><img src="./assets/ui/v2130/daily.png" alt=""><span>Login</span></button>
            <button class="top-nav-icon-button top-pass-button ${gamePassOpen?'active':''}" data-action="open-game-pass"><img src="./assets/ui/v2130/gamepass.png" alt=""><span>Game Pass</span></button>
            <button class="top-nav-icon-button top-bestiary-button ${bestiaryOpen?'active':''}" data-action="open-bestiary"><img src="./assets/ui/v2130/bestiary.png" alt=""><span>Bestiário</span></button>
            ${canUseForge?`<button class="top-nav-icon-button top-forge-button ${forgeOpen?'active':''}" data-action="open-forge"><img src="./assets/ui/v2130/forge.png" alt=""><span>Forja</span></button>`:''}
            <span id="connection-status" class="${networkStatus}">
              ${networkStatus === 'online' ? 'Online' : networkStatus === 'reconnecting' ? 'Reconectando...' : 'Offline'}
            </span>
            <span>${activeView === 'hunt'
              ? (zones.find(zone => zone.id === state.hunt.zoneId)?.name || 'Hunt')
              : activeView==='quest-expedition'
                ? (activeProgressionQuestDefinition()?.name || 'Quest')
                : 'Earth'}</span>
          </div>
        </header>

        <div class="classic-workspace">
          <section class="game-column">
            <div class="game-toolbar">
              <button data-view="world" class="${activeView === 'world' ? 'active' : ''}">PZ</button>
              <button data-view="pvp" class="${activeView === 'pvp' ? 'active' : ''}">PvP</button>
              <button data-action="open-ranking" class="${rankingOpen ? 'active' : ''}">Ranking</button>
              <span class="toolbar-spacer"></span>
              <span id="online-count">${presence.length + 1} jogador(es)</span>
            </div>

            <div class="game-viewport">
              ${renderMainView(char)}
            </div>

            ${renderClassicChat()}
            ${activeView === 'world'
              ? `<div class="activity-fabs">
                  <button id="hunt-fab" class="hunt-fab">HUNT</button>
                  <button id="training-fab" class="training-fab">TREINO</button>
                </div>`
              : ''}
          </section>

          ${huntChooserOpen ? renderHuntChooser() : ''}
          ${trainingChooserOpen ? renderTrainingChooser() : ''}
          ${spellBookSlot !== null ? renderSpellBook() : ''}
          ${consumableConfigOpen ? renderConsumableConfig() : ''}
          ${stopHuntConfirmOpen ? renderStopHuntConfirm() : ''}
          ${lootConfigOpen ? renderLootConfig() : ''}
          ${vendorOpen ? renderVendor() : ''}
          ${rebornNpcOpen ? renderRebornNpc() : ''}
          ${huntAnalyserOpen ? renderHuntAnalyser() : ''}
          ${marketDialog ? renderMarketDialog() : ''}
          ${partyPanelOpen ? renderPartyPanel() : ''}
          ${friendsPanelOpen ? renderFriendsPanel() : ''}
          ${playerContextTarget ? renderPlayerContextMenu() : ''}
          ${characterProfileOpen && characterProfileData ? renderCharacterProfile() : ''}
          ${tradeInvite ? renderTradeInvite() : ''}
          ${tradeState ? renderTradeWindow() : ''}
          ${pvpInvite ? renderPvpInvite() : ''}
          ${partyInvite ? renderPartyInvite() : ''}
          ${guildBossInvite ? renderGuildBossInvite() : ''}
          ${guildBossAcceptedCountdown ? renderGuildBossAcceptedCountdown() : ''}
          ${guildOpen ? renderGuild() : ''}
          ${marketOpen ? `<div class="ui-overlay-backdrop market-overlay"><div class="ui-overlay-window market-overlay-window">${renderMarket()}</div></div>` : ''}
          ${vipStoreOpen ? `<div class="ui-overlay-backdrop vip-overlay"><div class="ui-overlay-window vip-overlay-window">${renderVip()}</div></div>` : ''}
          ${premiumPurchaseOpen ? renderPremiumPurchase() : ''}
          ${npcShopOpen ? `<div class="ui-overlay-backdrop npc-shop-overlay"><div class="ui-overlay-window npc-shop-overlay-window">${renderNpcShop()}</div></div>` : ''}
          ${dailyGiftOpen ? renderDailyGift() : ''}
          ${gamePassOpen ? renderGamePass() : ''}
          ${mailOpen ? renderMail() : ''}
          ${bestiaryOpen ? renderBestiary() : ''}
          ${rankingOpen ? renderRanking() : ''}
          ${forgeOpen && canUseForge ? renderForge() : ''}
          ${renderStackMoveDialog()}
          ${renderOfflineReturnDialog()}

          <aside class="classic-sidebar">
            ${renderVitals(char)}
            ${renderMiniEquipment(char)}
            ${renderProgression()}
            ${renderBackpack()}
          </aside>
        </div>
      </div>
      <div id="item-tooltip" class="item-tooltip" role="tooltip"></div>
    `;

    bindEvents();
    bindContainerWindowResize();
    // The world map canvas is expensive to (re)mount — it fetches the
    // outfit manifest and sets up a render loop — so skip it while a
    // full-screen modal covers the world view anyway (e.g. the Hunt
    // picker). Every click inside that modal still triggers a full
    // render(); there's no reason to rebuild the hidden map underneath
    // each time.
    const worldObscured = huntChooserOpen || trainingChooserOpen || vendorOpen || rebornNpcOpen || Boolean(state.hunt?.offlineMode?.active);
    if (activeView === 'world' && !worldObscured) mountWorld();
    if (activeView === 'hunt') mountHuntArena();
    if (activeView === 'training') mountTrainingArena();
    scrollChat();

    root.querySelectorAll('[data-preserve-scroll]').forEach(el => {
      const key = el.getAttribute('data-preserve-scroll');
      const saved=preservedScroll.get(key);
      if(saved){el.scrollTop=Number(saved.top||0);el.scrollLeft=Number(saved.left||0);}
    });

    if (preservedFocus) {
      const newFocusEl = root.querySelector(
        `[data-preserve-focus="${preservedFocus.key}"]`
      );
      if (newFocusEl) {
        newFocusEl.focus();
        newFocusEl.setSelectionRange?.(
          preservedFocus.selectionStart, preservedFocus.selectionEnd
        );
      }
    }

    if (preservedWindowScroll) {
      requestAnimationFrame(() => window.scrollTo(
        preservedWindowScroll.x, preservedWindowScroll.y
      ));
    }
  }


  function currentForm(char) {
    return currentTransformationForm(state,char) || {
      id:'base',
      name:char?.name || 'Personagem',
      level:1,
      multiplier:1,
      portrait:char?.sprite,
      outfitId:char?.outfitId,
      vocationId:char?.vocationSourceId
    };
  }

  function nextTransformation(char) {
    return nextTransformationFor(
      state,
      char,
      standardTransformationTransitions
    );
  }

  function nextAvailableTransformation(char) {
    const next = nextTransformation(char);
    return next?.available ? next.form : null;
  }

  function characterPortrait(char) {
    return currentForm(char).portrait || char.sprite;
  }

  function characterOutfitId(char) {
    return currentForm(char).outfitId || char.outfitId;
  }

  function renderMainView(char) {
    if (activeView === 'world') {
      return earthMap
        ? `<canvas id="earth-map" class="earth-map"></canvas>
           <div class="map-label"><strong>PZ de Earth</strong></div>`
        : `<div class="map-loading">Carregando o mapa original de Earth...</div>`;
    }
    if (activeView === 'hunt') return renderHunt(char);
    if (activeView === 'quest-expedition') return renderProgressionQuestExpedition(char);
    if (activeView === 'training') return renderTraining(char);
    if (activeView === 'npcs') return renderNpcShop();
    if (activeView === 'inventory') return renderFullInventory(char);
    if (activeView === 'market') return renderMarket();
    if (activeView === 'vip') return renderVip();
    return renderPvp();
  }

  function formatBoostRemaining(until=0){
    const ms=Math.max(0,Number(until||0)-Date.now());
    if(ms<=0)return '';
    const total=Math.ceil(ms/1000),m=Math.floor(total/60),s=total%60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function renderActiveBoostBadges(){
    const now=Date.now(),rows=[];
    if(Number(state.profile.xpBoostUntil||0)>now)rows.push(`<span class="status-boost-badge xp" data-status-boost="xp"><img src="./assets/ui/v2130/boost-xp.png" alt="XP"><b>XP</b><em>${formatBoostRemaining(state.profile.xpBoostUntil)}</em></span>`);
    if(Number(state.profile.lootBoostUntil||0)>now)rows.push(`<span class="status-boost-badge loot" data-status-boost="loot"><img src="./assets/ui/v2130/boost-loot.png" alt="Loot"><b>LOOT</b><em>${formatBoostRemaining(state.profile.lootBoostUntil)}</em></span>`);
    return rows.join('');
  }

  function renderVitals(char) {
    const stats = totalStats(state, itemCatalog);
    const bestiary=ensureBestiaryState(state);
    const resources = maxResources(state, char, stats);
    const persistentMaxHp = Math.max(1, Number(resources.maxHp || 1));
    const persistentMaxKi = Math.max(1, Number(resources.maxKi || 1));

    state.profile.maxHp = persistentMaxHp;
    state.profile.maxKi = persistentMaxKi;

    if (state.profile.hp == null) state.profile.hp = persistentMaxHp;
    if (state.profile.ki == null) state.profile.ki = persistentMaxKi;

    const pvpOwn=activeView==='pvp'?pvpOwnParticipant():null;
    const maxHp=pvpOwn?Math.max(1,Number(pvpOwn.maxHp||1)):persistentMaxHp;
    const maxKi=pvpOwn?Math.max(1,Number(pvpOwn.maxKi||1)):persistentMaxKi;
    const hp=pvpOwn
      ? Math.min(maxHp,Math.max(0,Number(pvpOwn.hp||0)))
      : Math.min(maxHp,Math.max(0,Number(state.hunt.running?state.hunt.playerHp??state.profile.hp:state.profile.hp)));
    const ki=pvpOwn
      ? Math.min(maxKi,Math.max(0,Number(pvpOwn.ki||0)))
      : Math.min(maxKi,Math.max(0,Number(state.profile.ki)));
    const hpPct = Math.min(100, hp / maxHp * 100);
    const kiPct = Math.min(100, ki / maxKi * 100);

    return `
      <section class="classic-box status-box">
        <div class="classic-box-title">Status</div>
        <div class="portrait-row">
          <div class="portrait">
            <img class="sprite-pending" src="${characterPortrait(char)}?v=2058"
              onload="this.classList.remove('sprite-pending')" alt="${currentForm(char).name}">
          </div>
          <div class="portrait-info">
            <div class="portrait-name-with-boosts">${renderActiveBoostBadges()}<strong>${escapeHtml(state.profile.name)}</strong></div>
            <small>
              ${char.name} · Level ${state.profile.level}
              ${nextTransformation(char)
                ? nextTransformation(char).available
                  ? `<button class="transform-button"
                      data-action="transform-character"
                      title="Vocação ${nextTransformation(char).toVocation} ·
                        lookType ${nextTransformation(char).lookType}">
                      Transformar
                    </button>`
                  : `<span class="transform-requirement">
                      Próxima transformação: Lv
                      ${nextTransformation(char).requiredLevel}
                    </span>`
                : ''}
            </small>
            ${(() => {
              const progress = characterXpProgress(state.profile);
              return `<div class="classic-bar xp">
                <i style="width:${progress.percentage}%"></i>
                <span>${progress.percentage.toFixed(1)}%</span>
              </div>`;
            })()}
          </div>
        </div>
        <div class="classic-bar hp"><i style="width:${hpPct}%"></i><span>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span></div>
        <div class="classic-bar ki"><i style="width:${kiPct}%"></i><span>${Math.ceil(ki)} / ${Math.ceil(maxKi)}</span></div>
        <div class="status-grid">
          <span>⚔ ${Math.round(Number(stats.attack || 0))}</span><span>🛡 ${Math.round(Number(stats.defense || 0))}</span>
          <span>🏦 ${state.profile.bank || 0}</span><span class="status-pp">${ppIconHtml('inline')} ${Number(state.profile.premiumPoints ?? state.profile.vipCredits ?? 0)}</span>
        </div>
        <div class="bestiary-status-line"><span>📖 <b>${bestiaryAvailablePoints(state)}</b> pts</span><span>HP +${Number(bestiary.upgrades.hp||0)}%</span><span>KI +${Number(bestiary.upgrades.ki||0)}%</span><span>CRT +${(Number(bestiary.upgrades.critical||0)*.15).toLocaleString('pt-BR')}%</span></div>
      </section>
    `;
  }

  function renderMiniEquipment(char) {
    const positions = ['helmet','necklace','backpack','armor','weapon','offhand','legs','boots','ring','ammo'];
    return `
      <section class="classic-box">
        <div class="classic-box-title">Equipamentos</div>
        <div class="classic-paperdoll">
          <div class="mini-character">
            <img class="sprite-pending" src="${characterPortrait(char)}?v=2058" onload="this.classList.remove('sprite-pending')">
          </div>
          ${positions.map(slot => {
            const equippedId = slot === 'backpack'
              ? state.containers?.[state.equipment.backpack]?.itemId
              : state.equipment[slot];
            const baseItem = itemCatalog[equippedId];
            const item = slot === 'backpack' ? baseItem : rarityAdjustedItem(baseItem, state.equipmentMeta?.[slot]);
            const backpackAction = slot === 'backpack' && item
              ? `data-open-container="${state.equipment.backpack}"`
              : '';
            return `<button class="classic-equip slot-${slot} ${item ? 'occupied' : ''}"
              data-equip-drop="${slot}" ${backpackAction}
              ${item
                ? `draggable="true" data-drag-equipment="${slot}" ${slot!=='backpack'?`data-unequip="${slot}"`:''}`
                : ''}
              ${item ? `data-tooltip-item="${item.id}" data-tooltip-slot="${slot}" data-tooltip-rarity="${item.rarity||'common'}"` : ''}
              aria-label="${slotNames[slot]}${item ? ': ' + item.name : ''}">
              ${item ? `${itemVisual(item)}<small>${item.name}</small>` : `<span class="slot-placeholder">${slotIcon(slot)}</span>`}
            </button>`;
          }).join('')}
        </div>
      </section>
    `;
  }


  function progressionNumber(value) {
    return Math.max(0,Math.floor(Number(value || 0)))
      .toLocaleString('pt-BR');
  }

  function renderProgressionSkill(id, definition) {
    const skill=state.skills[id];
    if(!skill)return '';

    const progress=skillProgress(skill);
    const remaining=Math.max(
      0,
      Number(progress.required || 0)-Number(skill.tries || 0)
    );

    return `<article class="progression-entry"
      title="${escapeHtml(definition.description)}">
      <div class="progression-entry-head">
        <strong>${escapeHtml(definition.name || definition.short)}</strong>
        <b>${skill.level}</b>
      </div>
      <div class="progression-track">
        <i style="width:${progress.percentage}%"></i>
      </div>
      <small>
        ${id==='critical'
          ? 'Evolui por equipamentos e consumíveis'
          : `Faltam ${progressionNumber(remaining)} tries para upar`}
      </small>
    </article>`;
  }

  function renderProgressionContents() {
    const levelProgress=characterXpProgress(state.profile);
    const levelRemaining=Math.max(
      0,
      Number(levelProgress.required || 0)-
      Number(levelProgress.current || 0)
    );

    return `
      <article class="progression-entry level-entry">
        <div class="progression-entry-head">
          <strong>Level</strong>
          <b>${state.profile.level}</b>
        </div>
        <div class="progression-track level-track">
          <i style="width:${levelProgress.percentage}%"></i>
        </div>
        <small>
          Faltam ${progressionNumber(levelRemaining)} XP para upar
          · Rate ${experienceRate(state.profile.level)}×
        </small>
      </article>

      ${Object.entries(skillDefinitions)
        .map(([id,definition]) =>
          renderProgressionSkill(id,definition)
        )
        .join('')}`;
  }

  function renderProgression() {
    return `
      <section class="classic-box progression-box
          ${progressionOpen ? 'open' : 'closed'}">
        <button class="progression-toggle"
          data-action="toggle-progression"
          aria-expanded="${progressionOpen}">
          <span>Progressão</span>
          <i>${progressionOpen ? '−' : '+'}</i>
        </button>
        ${progressionOpen ? `
          <div class="progression-scroll">
            ${renderProgressionContents()}
          </div>
        ` : ''}
      </section>`;
  }


  function renderBackpack() {
    return [
      ...openContainerIds.map(id => renderContainerWindow(id)),
      openDepotContainerId ? renderContainerWindow(openDepotContainerId) : ''
    ].join('');
  }


  function renderContainerWindow(containerId) {
    const container = openContainer(state, containerId);
    if (!container) return '';
    const path = containerPath(state, containerId);
    const rootContainer = path[0] || container;
    const isVipDepot=(state.vipDepotContainerIds||[]).includes(rootContainer.id);
    const windowKind = rootContainer.id === state.depotContainerId || isVipDepot ? 'depot' : 'backpack';
    const positionKey = windowKind === 'depot' ? 'depot' : `container:${container.id}`;
    const savedPosition = state.settings?.containerWindowPositions?.[positionKey] || state.settings?.containerWindowPositions?.[windowKind];
    const rawSavedHeight = windowKind==='backpack' ? Number(state.settings?.containerWindowHeights?.[positionKey]||0) : 0;
    // V21.23 — a Backpack pode ser redimensionada, mas nunca deve criar uma
    // parede de slots gigantes. A janela mostra no máximo 40 slots (10 linhas
    // de 4); backpacks menores param exatamente na própria capacidade e as
    // células mantêm 48x48 px. Capacidades acima de 40 continuam acessíveis
    // pela rolagem interna.
    const visibleBackpackSlots = windowKind==='backpack'
      ? Math.max(1,Math.min(40,Number(container.capacity||0)))
      : 0;
    const visibleBackpackRows = windowKind==='backpack'
      ? Math.max(1,Math.ceil(visibleBackpackSlots/4))
      : 0;
    const backpackGridMaxHeight = visibleBackpackRows * 50 + 16;
    const backpackPanelMaxHeight = backpackGridMaxHeight + 190;
    const savedHeight = windowKind==='backpack' && rawSavedHeight
      ? Math.max(190,Math.min(backpackPanelMaxHeight,rawSavedHeight))
      : 0;
    const positionStyle = savedPosition &&
      Number.isFinite(Number(savedPosition.x)) &&
      Number.isFinite(Number(savedPosition.y))
      ? `left:${Math.max(0,Number(savedPosition.x))}px!important;top:${Math.max(0,Number(savedPosition.y))}px!important;right:auto!important;bottom:auto!important;`
      : (windowKind === 'backpack'
        ? `right:${3 + Math.max(0, openContainerIds.indexOf(container.id)) * 272}px!important;bottom:3px!important;`
        : '');
    const containerItem = itemCatalog[container.itemId];
    const vipDepotIndex=(state.vipDepotContainerIds||[]).indexOf(container.id);
    const containerTitle = container.id === state.depotContainerId ? 'Depot' : vipDepotIndex>=0 ? `[VIP] Depot ${vipDepotIndex+1}` : (containerItem?.name || 'Backpack');
    const slots = containerSlots(container);
    const filterCategories = container.lootFilter?.categories || [];
    const lootFilterLabel = {
      potions:'Potions',senzus:'Senzus',equipment:'Equipamentos',collectibles:'Coletáveis'
    };
    return `
      <div class="container-window-backdrop container-window-${windowKind}"
        data-container-window-kind="${windowKind}"
        data-container-target-id="${container.id}"
        data-container-position-key="${positionKey}"
        style="${positionStyle}">
        <section class="container-window container-window-panel-${windowKind}" data-container-window="${windowKind}" data-container-resize-key="${positionKey}" ${windowKind==='backpack'?`style="--container-grid-max-height:${backpackGridMaxHeight}px;--container-window-max-height:${backpackPanelMaxHeight}px;max-height:min(${backpackPanelMaxHeight}px,calc(100vh - 8px))!important;${savedHeight?`height:${savedHeight}px!important;`:''}"`:''}>
          <header data-container-drag-handle>
            <div>
              <strong>${containerTitle}</strong>
              <small>${container.items.length}/${container.capacity} slots</small>
            </div>
            <button class="container-layout-lock ${container.layoutLocked?'active':''}"
              data-container-lock="${container.id}"
              title="${container.layoutLocked?'Destravar organização':'Travar organização'}"
              aria-label="${container.layoutLocked?'Destravar organização':'Travar organização'}">${container.layoutLocked?'🔒':'🔓'}</button>
            <button class="container-auto-organize" data-container-organize="${container.id}" ${container.layoutLocked?'disabled':''}
              title="Organizar automaticamente" aria-label="Organizar automaticamente">↕</button>
            <button class="container-close-button" data-action="close-container" data-close-container-kind="${windowKind}" data-close-container-id="${container.id}">×</button>
          </header>
          ${windowKind==='depot'?`<nav class="vip-depot-tabs"><button data-open-depot-tab="${state.depotContainerId}" class="${container.id===state.depotContainerId?'active':''}">Depot</button>${Number(state.profile?.vipUntil||0)>Date.now()?(state.vipDepotContainerIds||[]).map((id,i)=>`<button data-open-depot-tab="${id}" class="${container.id===id?'active':''}">[VIP] ${i+1}</button>`).join(''):'<small>Ative VIP para liberar 3 Depots de 400 slots.</small>'}</nav>`:''}
          ${path.length > 1 ? `<nav class="container-path">
            ${path.slice(0, -1).map(entry => {
              const item = itemCatalog[entry.itemId];
              return `<button data-open-container="${entry.id}">
                ${item?.name || 'Backpack'}
              </button>`;
            }).join('<span>›</span>')}
          </nav>` : ''}
          ${windowKind==='backpack'?`<details class="container-loot-filter" ${filterCategories.length?'open':''}>
            <summary>Filtro de Loot ${filterCategories.length?`<b>${filterCategories.length}</b>`:''}</summary>
            <p>Quando marcado, o loot automático desta backpack aceita somente as categorias escolhidas.</p>
            <div>${Object.entries(lootFilterLabel).map(([id,label])=>`<label><input type="checkbox" data-container-loot-filter="${container.id}" value="${id}" ${filterCategories.includes(id)?'checked':''}> ${label}</label>`).join('')}</div>
            <small>Sem categorias marcadas = aceita qualquer loot.</small>
          </details>`:''}
          <div class="classic-container-grid expanded">
            ${slots.map((slot, uiSlot) => slot
              ? renderContainerItem(slot.entry, container.id, slot.index, uiSlot, container.layoutLocked)
              : `<div class="classic-item empty container-slot-target" data-container-slot="${uiSlot}" data-container-slot-container="${container.id}"><small>${uiSlot + 1}</small></div>`
            ).join('')}
          </div>
        </section>
      </div>
    `;
  }

  function bindContainerWindowResize(){
    if(typeof ResizeObserver==='undefined')return;
    root.querySelectorAll('.container-window-panel-backpack[data-container-resize-key]').forEach(panel=>{
      let initial=true,timer=null;
      const observer=new ResizeObserver(entries=>{
        if(initial){initial=false;return;}
        const height=Math.round(entries[0]?.contentRect?.height||0);if(height<190)return;
        clearTimeout(timer);timer=setTimeout(()=>{
          state.settings ||= {};state.settings.containerWindowHeights ||= {};
          const cssMax=Number.parseFloat(getComputedStyle(panel).getPropertyValue('--container-window-max-height'))||780;
          state.settings.containerWindowHeights[panel.dataset.containerResizeKey]=Math.max(190,Math.min(cssMax,height));
          persist();
        },250);
      });
      observer.observe(panel);
    });
  }

  function renderContainerItem(entry, containerId, index, uiSlot = Number(entry?.uiSlot ?? index), layoutLocked = false) {
    const baseItem = itemCatalog[entry.itemId];
    const item = rarityAdjustedItem(baseItem,entry);
    if (!item) return `<div class="classic-item empty"></div>`;
    const details = itemDetails(item);
    const action = entry.containerId
      ? `data-open-container="${entry.containerId}"`
      : `data-item="${item.id}"`;
    return `<button class="classic-item rarity-${item.rarity} ${entry.locked ? 'item-sale-locked' : ''}"
      draggable="${layoutLocked?'false':'true'}"
      data-drag-container="${containerId}"
      data-drag-index="${index}"
      data-container-slot="${uiSlot}"
      data-container-slot-container="${containerId}"
      data-entry-item="${item.id}"
      data-instance-id="${entry.instanceId||''}"
      ${entry.containerId ? `data-nested-container-target="${entry.containerId}"` : ''}
      ${action}
      data-tooltip-item="${item.id}"
      data-tooltip-rarity="${item.rarity||'common'}"
      aria-label="${escapeHtml(item.name)}">
      ${itemVisual(item)}
      <b data-entry-quantity="${containerId}:${index}">
        ${entry.quantity > 1 ? entry.quantity : ''}
      </b>
    </button>`;
  }


  function renderClassicChat() {
    const messages=state.chat.filter(message => {
      if(activeChatTab==='loot') return message.channel==='loot';
      if(activeChatTab==='server') return message.channel==='server' || (Boolean(message.system) && message.channel!=='loot');
      return !message.system && (message.channel==null || message.channel==='default');
    });
    const emptyLabel=activeChatTab==='loot'
      ? 'Nenhum loot registrado nesta sessao.'
      : activeChatTab==='server'
        ? 'Nenhuma mensagem do servidor.'
        : 'Nenhuma mensagem de jogador.';
    return `
      <section class="classic-chat">
        <div class="chat-tabs">
          <button data-chat-tab="default"
            class="${activeChatTab==='default'?'active':''}">
            Default
          </button>
          <button data-chat-tab="server"
            class="${activeChatTab==='server'?'active':''}">
            Server Log
          </button>
          <button data-chat-tab="loot"
            class="${activeChatTab==='loot'?'active':''}">
            Loot
          </button>
        </div>
        <div id="chat-messages" class="classic-chat-messages">
          ${messages.length ? messages.map(m => `
            <div class="${m.system ? 'system' : ''} ${m.channel==='loot'?'loot-message':''}">
              <time>${formatTime(m.at)}</time>
              <strong>${escapeHtml(m.author)}:</strong>
              <span>${escapeHtml(m.text)}</span>
            </div>`).join('') : `<div class="system"><span>${emptyLabel}</span></div>`}
        </div>
        <form id="chat-form" class="classic-chat-form">
          <select aria-label="Canal"><option>Default</option></select>
          <input id="chat-input" maxlength="300" autocomplete="off"
            placeholder="Digite sua mensagem ou comando...">
          <button type="submit">Enviar</button>
        </form>
      </section>
    `;
  }


  function renderTrainingChooser() {
    const roomIcons = {
      'punching-bag':'./assets/ui/training-v2110/punching-bag.png',
      'time-chamber':'./assets/ui/training-v2110/time-chamber.png',
      'ki-barrier':'./assets/ui/training-v2110/ki-barrier.png'
    };
    const roomLabels = {
      'punching-bag':'Treino físico',
      'time-chamber':'Movimento',
      'ki-barrier':'Controle de Ki'
    };

    return `
      <div class="hunt-modal-backdrop training-modal-backdrop">
        <section class="training-selection-panel training-selection-v2">
          <header>
            <div>
              <span class="training-kicker">CENTRO DE TREINAMENTO</span>
              <h2>Escolha sua sala</h2>
              <small>
                O progresso das Punching Bags é 3× mais rápido que na Hunt.
              </small>
            </div>
            <button class="training-close"
              data-action="close-training-chooser">×</button>
          </header>

          <div class="training-room-grid">
            ${trainingRooms.map(room => `
              <button class="training-room-card
                  ${pendingTrainingRoomId === room.id ? 'selected' : ''}"
                data-training-room="${room.id}">
                <div class="training-room-preview room-${room.color}">
                  <span class="training-room-icon">
                    <img src="${roomIcons[room.id]}" alt="" loading="eager">
                  </span>
                  <em>${roomLabels[room.id]}</em>
                </div>
                <div class="training-room-copy">
                  <strong>${escapeHtml(room.name)}</strong>
                  <p>${escapeHtml(room.description)}</p>
                  <div class="training-skill-tags">
                    ${room.skills.map(skill =>
                      `<span>${escapeHtml(skill)}</span>`
                    ).join('')}
                  </div>
                </div>
                <div class="training-card-check">
                  ${pendingTrainingRoomId === room.id ? '✓ Selecionado' : 'Selecionar'}
                </div>
              </button>
            `).join('')}
          </div>

          <footer>
            <div>
              <strong>Regra de segurança</strong>
              <span>Os alvos de treino não causam perda de HP ou XP.</span>
            </div>
            <div class="training-footer-actions">
              <button data-action="close-training-chooser">Cancelar</button>
              <button class="confirm" data-action="confirm-training">
                Entrar na sala
              </button>
            </div>
          </footer>
        </section>
      </div>
    `;
  }

  function renderTraining(char) {
    const room = training.currentRoom();
    return `
      <div class="training-arena-page">
        <canvas id="training-canvas"></canvas>
        <div class="training-header">
          <div>
            <strong>${escapeHtml(room.name)}</strong>
            <span>${escapeHtml(room.description)}</span>
          </div>
          <button data-action="stop-training">PARAR TREINO</button>
        </div>
        <div class="training-rate-badge">Skills 3×</div>
      </div>
    `;
  }

  function npcBuyCatalog() {
    return [
      {item:itemCatalog.server_12775,price:200,category:'Potion'},
      {item:itemCatalog.server_12776,price:200,category:'Potion'},
      {item:itemCatalog.server_12777,price:400,category:'Senzu'},
      {item:itemCatalog.server_12778,price:1000,category:'Senzu'},
      {item:itemCatalog.server_12779,price:2500,category:'Senzu'},
      {item:itemCatalog.server_7636,price:4500,category:'Senzu'},
      {item:itemCatalog.red_capsule,price:5000,category:'Cápsula'},
      {item:itemCatalog.silver_capsule,price:5000,category:'Cápsula'}
    ].filter(entry => entry.item);
  }

  function isNpcSaleBlocked(item) {
    const name = String(item?.name || '').toLowerCase();
    const isPotionOrSenzu =
      item?.consumableKind === 'hp' ||
      item?.consumableKind === 'ki' ||
      item?.consumableKind === 'senzu' ||
      name.includes('potion') ||
      name.includes('senzu');

    return (
      !item ||
      item.noNpcSell === true ||
      item.playerMarketOnly === true ||
      isPotionOrSenzu ||
      item.type === 'currency' ||
      item.type === 'backpack'
    );
  }

  function npcSellableEntries() {
    // Mostra também os itens protegidos para que o cadeado seja controlado
    // exatamente na tela de venda. Vender/selecionar continua ignorando locks.
    return vendorEntries().filter(({item}) => !isNpcSaleBlocked(item));
  }

  function npcSellKey(containerId, index) {
    return `${containerId}:${index}`;
  }

  function npcSellRarityTier(item, entry) {
    return isRarityEligibleItem(item)
      ? rarityDefinition(entry?.rarity || 'common').tier
      : 0;
  }

  function npcSellBelowDefinition() {
    const def = rarityDefinition(npcSellBelowRarity || 'legendary');
    return def.tier > 0 ? def : rarityDefinition('legendary');
  }

  function npcBulkSellEntries() {
    const threshold = npcSellBelowDefinition().tier;
    return npcSellableEntries().filter(({entry,item}) =>
      !entry.locked && npcSellRarityTier(item,entry) < threshold
    );
  }

  function selectedNpcSellEntries() {
    return npcSellableEntries().filter(({container,index,entry}) =>
      !entry.locked && npcSelectedSellKeys.has(npcSellKey(container.id, index))
    );
  }

  function renderNpcShop() {
    const products = npcBuyCatalog();
    const selected =
      products.find(entry => entry.item.id === npcSelectedBuyId) ||
      products[0];

    if (selected) npcSelectedBuyId = selected.item.id;
    npcBuyQuantity = Math.max(
      1,
      Math.min(1000, Number(npcBuyQuantity) || 1)
    );

    const sellable = npcSellableEntries();
    const unlockedSellable = sellable.filter(({entry}) => !entry.locked);
    const bulkSellable = npcBulkSellEntries();
    const bulkThreshold = npcSellBelowDefinition();
    const selectedSell = selectedNpcSellEntries();
    const selectedTotal = selectedSell.reduce(
      (sum,{entry,unitPrice}) =>
        sum + Number(unitPrice || 0) * Number(entry.quantity || 1),
      0
    );
    const allTotal = bulkSellable.reduce(
      (sum,{entry,unitPrice}) =>
        sum + Number(unitPrice || 0) * Number(entry.quantity || 1),
      0
    );

    return `
      <section class="npc-shop-page npc-market">
        <header class="npc-market-header">
          <div>
            <h2>🛒 Loja de Earth</h2>
            <p>Compre suprimentos e venda drops das Hunts.</p>
          </div>
          <div class="npc-market-header-actions">
            <div class="npc-bank">
              🏦 <strong>${Number(state.profile.bank || 0).toLocaleString('pt-BR')}</strong>
              <span>Gold</span>
            </div>
            <button class="npc-shop-close" data-action="close-npc-shop"
              title="Fechar loja e voltar ao PZ" aria-label="Fechar loja">×</button>
          </div>
        </header>

        <nav class="npc-market-tabs">
          <button class="${npcShopTab === 'buy' ? 'active buy' : ''}"
            data-npc-tab="buy">🛒 Comprar</button>
          <button class="${npcShopTab === 'sell' ? 'active sell' : ''}"
            data-npc-tab="sell">💰 Vender</button>
        </nav>

        ${npcShopTab === 'buy'
          ? `<div class="npc-buy-layout">
              <section class="npc-market-list">
                <header>
                  <div>
                    <strong>Produtos</strong>
                    <small>Potions, Senzus e cápsulas de 25 espaços.</small>
                  </div>
                </header>
                <div class="npc-product-cards" data-preserve-scroll="npc-product-cards">
                  ${products.map(({item,price,category}) => `
                    <button class="npc-market-card
                      ${item.id === selected?.item.id ? 'selected' : ''}"
                      data-npc-select-buy="${item.id}"
                      data-tooltip-item="${item.id}">
                      ${itemVisual(item)}
                      <strong>${escapeHtml(item.name)}</strong>
                      <small>${category}</small>
                      <em>${item.type === 'backpack'
                        ? '25 espaços'
                        : 'Consumível'}</em>
                      <span class="npc-owned-count" data-npc-owned-count="${item.id}">
                        Possui: ${itemQuantity(state,item.id).toLocaleString('pt-BR')}
                      </span>
                      <b>${price.toLocaleString('pt-BR')} Gold</b>
                    </button>
                  `).join('')}
                </div>
              </section>

              <aside class="npc-purchase-detail">
                ${selected ? `
                  ${itemVisual(selected.item)}
                  <h3>${escapeHtml(selected.item.name)}</h3>
                  <p>${selected.item.type === 'backpack'
                    ? 'Container com 25 espaços.'
                    : selected.item.restoreHp && selected.item.restoreKi
                      ? `Recupera ${Number(selected.item.restoreHp).toLocaleString('pt-BR')} de HP e ${Number(selected.item.restoreKi).toLocaleString('pt-BR')} de Ki.`
                      : selected.item.restoreHp
                        ? `Recupera ${Number(selected.item.restoreHp).toLocaleString('pt-BR')} de HP.`
                        : `Recupera ${Number(selected.item.restoreKi||0).toLocaleString('pt-BR')} de Ki.`}</p>
                  <dl>
                    <div>
                      <dt>Preço unitário</dt>
                      <dd>${selected.price.toLocaleString('pt-BR')} Gold</dd>
                    </div>
                    <div>
                      <dt>Você possui</dt>
                      <dd>${itemQuantity(state, selected.item.id)
                        .toLocaleString('pt-BR')}</dd>
                    </div>
                  </dl>

                  <div class="npc-quantity-control">
                    <button data-npc-quantity-step="-1">−</button>
                    <input id="npc-buy-quantity" type="number"
                      min="1" max="1000" value="${npcBuyQuantity}">
                    <button data-npc-quantity-step="1">+</button>
                  </div>
                  <div class="npc-quantity-presets">
                    <button data-npc-add-quantity="1">+1</button>
                    <button data-npc-add-quantity="10">+10</button>
                    <button data-npc-add-quantity="100">+100</button>
                    <button data-npc-set-quantity="1000">MAX</button>
                  </div>

                  <div class="npc-purchase-total">
                    <span>Total</span>
                    <strong>${(selected.price * npcBuyQuantity)
                      .toLocaleString('pt-BR')} Gold</strong>
                  </div>
                  <div class="npc-purchase-balance">
                    <span>Após a compra</span>
                    <strong class="${
                      Number(state.profile.bank || 0) >=
                      selected.price * npcBuyQuantity
                        ? 'positive' : 'negative'
                    }">${(
                      Number(state.profile.bank || 0) -
                      selected.price * npcBuyQuantity
                    ).toLocaleString('pt-BR')} Gold</strong>
                  </div>
                  <button class="npc-confirm-purchase"
                    data-npc-confirm-buy="${selected.item.id}"
                    data-unit-price="${selected.price}">
                    🛒 Comprar ${npcBuyQuantity.toLocaleString('pt-BR')}×
                  </button>
                ` : '<p>Nenhum produto disponível.</p>'}
              </aside>
            </div>`
          : `<div class="npc-sell-layout">
              <section class="npc-market-list">
                <header>
                  <div>
                    <strong>Itens vendáveis</strong>
                    <small>
                      Consumíveis e containers não aparecem na venda.
                    </small>
                  </div>
                  <div class="npc-sell-summary">
                    <span>Selecionados</span>
                    <b>${selectedSell.length}</b>
                    <strong>${selectedTotal.toLocaleString('pt-BR')} Gold</strong>
                  </div>
                </header>

                <div class="npc-sell-toolbar">
                  <button data-npc-select-all>Selecionar todos</button>
                  <button data-npc-clear-selection>Limpar seleção</button>
                </div>

                <div class="npc-sell-cards" data-preserve-scroll="npc-sell-cards">
                  ${sellable.length
                    ? sellable.map(({container,entry,index,item,unitPrice}) => {
                        const key = npcSellKey(container.id, index);
                        const checked = !entry.locked && npcSelectedSellKeys.has(key);
                        const displayItem = rarityAdjustedItem(item,entry);
                        return `<div class="npc-sell-card rarity-${displayItem.rarity||'common'}
                            ${checked ? 'selected' : ''}
                            ${entry.locked ? 'sale-locked' : ''}"
                            data-tooltip-item="${item.id}" data-tooltip-rarity="${displayItem.rarity||'common'}">
                          <div class="npc-sell-card-select"
                            ${entry.locked ? '' : `data-npc-toggle-sell="${key}"`}>
                            <span class="npc-sell-check">
                              ${entry.locked ? '🔒' : (checked ? '✓' : '')}
                            </span>
                            ${itemVisual(displayItem)}
                            <strong>${escapeHtml(displayItem.name)}</strong>
                            <small>${entry.quantity} unidade(s)${entry.locked ? ' · Protegido' : ''}</small>
                            <b>${(
                              Number(unitPrice || 0) *
                              Number(entry.quantity || 1)
                            ).toLocaleString('pt-BR')} Gold</b>
                          </div>
                          <button class="npc-sale-lock ${entry.locked ? 'locked' : ''}"
                            data-toggle-sale-lock="${container.id}:${index}:${item.id}:${entry.instanceId||''}"
                            title="${entry.locked ? 'Desproteger da venda' : 'Proteger contra Vender tudo'}">
                            ${entry.locked ? '🔒' : '🔓'}
                          </button>
                        </div>`;
                      }).join('')
                    : `<div class="npc-empty-sale">
                        Nenhum drop vendável nas backpacks.
                      </div>`}
                </div>
              </section>

              <aside class="npc-sale-detail">
                <h3>Resumo da venda</h3>
                <dl>
                  <div>
                    <dt>Itens selecionados</dt>
                    <dd>${selectedSell.length}</dd>
                  </div>
                  <div>
                    <dt>Valor selecionado</dt>
                    <dd>${selectedTotal.toLocaleString('pt-BR')} Gold</dd>
                  </div>
                  <div>
                    <dt>Valor abaixo de ${bulkThreshold.name}</dt>
                    <dd>${allTotal.toLocaleString('pt-BR')} Gold</dd>
                  </div>
                </dl>
                <button class="npc-sell-selected"
                  data-npc-sell-selected
                  ${selectedSell.length ? '' : 'disabled'}>
                  💰 Vender selecionados
                </button>
                <div class="npc-bulk-sale-protection">
                  <label for="npc-sell-below-rarity">Vender tudo abaixo de</label>
                  <select id="npc-sell-below-rarity" data-npc-sell-below-rarity>
                    ${['rare','super_rare','epic','legendary','super_legendary','mythic','divine'].map(id => {
                      const def=rarityDefinition(id);
                      return `<option value="${def.id}" ${def.id===bulkThreshold.id?'selected':''}>${def.name}</option>`;
                    }).join('')}
                  </select>
                  <small>Itens ${bulkThreshold.name} ou superiores ficam protegidos automaticamente.</small>
                </div>
                <button class="npc-sell-all"
                  data-npc-sell-all
                  ${bulkSellable.length ? '' : 'disabled'}>
                  💰 Vender tudo abaixo de ${bulkThreshold.name}
                </button>
                <p>
                  Cadeados individuais continuam valendo. Potions, Senzus,
                  consumíveis, backpacks e cápsulas não podem ser vendidos.
                </p>
              </aside>
            </div>`}
      </section>
    `;
  }

  function formatHuntDuration(seconds){
    const total=Math.max(0,Math.floor(Number(seconds||0)));
    const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
    return [h,m,sec].map(v=>String(v).padStart(2,'0')).join(':');
  }

  function huntAnalyserValues(){
    const a=state.hunt?.analyser||{};
    const activeMs=Math.max(0,Number(a.activeMs||0));
    const hours=Math.max(1/3600,activeMs/3600000);
    const rawZeni=Number(a.zeni||0),lootValue=Number(a.lootValue||0),supplySpent=Number(a.supplySpent||0);
    const grossZeni=rawZeni+lootValue;
    return {
      activeMs,
      xp:Number(a.xp||0),
      zeni:grossZeni,
      rawZeni,
      lootValue,
      supplySpent,
      profit:grossZeni-supplySpent,
      kills:Number(a.kills||0),
      xpHour:Number(a.xp||0)/hours,
      zeniHour:grossZeni/hours,
      supplyHour:supplySpent/hours,
      profitHour:(grossZeni-supplySpent)/hours,
      killsHour:Number(a.kills||0)/hours,
      drops:Object.entries(a.drops||{}).map(([key,quantity])=>{
        const [itemId,rarity='common']=key.split('|');
        return {key,itemId,rarity,quantity:Number(quantity||0)};
      }).sort((x,y)=>y.quantity-x.quantity)
    };
  }

  function renderAnalyserDrops(){
    const values=huntAnalyserValues();
    return values.drops.slice(0,10).map(drop=>{
      const item=itemCatalog[drop.itemId];
      if(!item)return '';
      return `<div class="hunt-analyser-drop" data-tooltip-item="${drop.itemId}" data-tooltip-rarity="${drop.rarity}">
        ${marketItemCard(drop.itemId,drop.rarity)}
        <span>${escapeHtml(item.name)}<small>${drop.quantity.toLocaleString('pt-BR')} drop(s)</small></span>
      </div>`;
    }).join('')||'<p class="hunt-analyser-empty">Nenhum drop registrado ainda.</p>';
  }

  function renderHuntAnalyser(){
    const values=huntAnalyserValues();
    const charge=Math.max(0,Math.min(21600,Number(state.profile.offlineChargeSeconds??21600)));
    const offline=state.hunt?.offlineMode||{};
    const sampleReady=values.activeMs>=60000;
    const pos=huntAnalyserPosition&&Number.isFinite(huntAnalyserPosition.x)&&Number.isFinite(huntAnalyserPosition.y)?`left:${huntAnalyserPosition.x}px;top:${huntAnalyserPosition.y}px;right:auto;`:'';
    return `<div class="hunt-analyser-window" data-preserve-scroll="hunt-analyser" style="${pos}">
      <header data-analyser-drag-handle title="Arraste para mover"><div><strong>Hunt Analyser</strong><small>Ganhos, custos e lucro estimado da Hunt</small></div><button data-action="close-hunt-analyser">×</button></header>
      <div class="hunt-analyser-stats">
        <div><span>Tempo online</span><b data-analyser-time>${formatHuntDuration(values.activeMs/1000)}</b></div>
        <div><span>Experiência</span><b data-analyser-xp>${Math.floor(values.xp).toLocaleString('pt-BR')}</b><small data-analyser-xph>${Math.floor(values.xpHour).toLocaleString('pt-BR')}/h</small></div>
        <div><span>Zeni + valor dos drops</span><b data-analyser-zeni>${Math.floor(values.zeni).toLocaleString('pt-BR')}</b><small data-analyser-zenih>${Math.floor(values.zeniHour).toLocaleString('pt-BR')}/h</small></div>
        <div><span>Supplies gastos</span><b data-analyser-supply>${Math.floor(values.supplySpent).toLocaleString('pt-BR')}</b><small data-analyser-supplyh>${Math.floor(values.supplyHour).toLocaleString('pt-BR')}/h</small></div>
        <div><span>Lucro estimado</span><b data-analyser-profit class="${values.profit>=0?'positive':'negative'}">${Math.floor(values.profit).toLocaleString('pt-BR')}</b><small data-analyser-profith>${Math.floor(values.profitHour).toLocaleString('pt-BR')}/h</small></div>
        <div><span>Kills</span><b data-analyser-kills>${Math.floor(values.kills).toLocaleString('pt-BR')}</b><small data-analyser-killsh>${values.killsHour.toFixed(1)}/h</small></div>
      </div>
      <section><h4>Top drops</h4><div class="hunt-analyser-drops">${renderAnalyserDrops()}</div></section>
      <section class="offline-mode-card">
        <div class="offline-mode-title"><strong>Modo Offline · 50%</strong><span data-offline-charge>${formatHuntDuration(charge)}</span></div>
        <div class="offline-charge-bar"><i data-offline-charge-bar style="width:${charge/21600*100}%"></i></div>
        <small>Máximo de 6 horas. Cada 1 minuto online recarrega 1 minuto offline. Os ganhos usam a média do Analyser e são pagos a 50%.</small>
        ${offline.active
          ? `<button class="offline-stop" data-action="offline-stop">Encerrar agora e receber</button>`
          : `<button class="offline-start" data-action="offline-start" ${sampleReady&&charge>=60?'':'disabled'}>Ativar modo offline</button>`}
        ${!sampleReady?'<em>Cace por pelo menos 1 minuto para calibrar.</em>':''}
        ${offline.lastReport?`<p class="offline-last-report">Último offline: ${formatHuntDuration(offline.lastReport.elapsedSeconds)} · +${Number(offline.lastReport.xp||0).toLocaleString('pt-BR')} XP · +${Number(offline.lastReport.zeni||0).toLocaleString('pt-BR')} Zeni</p>`:''}
      </section>
      <footer><button data-action="reset-hunt-analyser">Limpar Analyser</button></footer>
    </div>`;
  }

  function updateHuntAnalyserPanel(){
    if(!huntAnalyserOpen)return;
    const panel=root.querySelector('.hunt-analyser-window');
    if(!panel)return;
    const values=huntAnalyserValues();
    const set=(sel,val)=>{const el=panel.querySelector(sel);if(el)el.textContent=val;};
    set('[data-analyser-time]',formatHuntDuration(values.activeMs/1000));
    set('[data-analyser-xp]',Math.floor(values.xp).toLocaleString('pt-BR'));
    set('[data-analyser-xph]',`${Math.floor(values.xpHour).toLocaleString('pt-BR')}/h`);
    set('[data-analyser-zeni]',Math.floor(values.zeni).toLocaleString('pt-BR'));
    set('[data-analyser-zenih]',`${Math.floor(values.zeniHour).toLocaleString('pt-BR')}/h`);
    set('[data-analyser-supply]',Math.floor(values.supplySpent).toLocaleString('pt-BR'));
    set('[data-analyser-supplyh]',`${Math.floor(values.supplyHour).toLocaleString('pt-BR')}/h`);
    set('[data-analyser-profit]',Math.floor(values.profit).toLocaleString('pt-BR'));
    set('[data-analyser-profith]',`${Math.floor(values.profitHour).toLocaleString('pt-BR')}/h`);
    set('[data-analyser-kills]',Math.floor(values.kills).toLocaleString('pt-BR'));
    set('[data-analyser-killsh]',`${values.killsHour.toFixed(1)}/h`);
    const drops=panel.querySelector('.hunt-analyser-drops');
    if(drops){drops.innerHTML=renderAnalyserDrops();bindItemTooltipTargets(drops);}
    const charge=Math.max(0,Math.min(21600,Number(state.profile.offlineChargeSeconds??21600)));
    set('[data-offline-charge]',formatHuntDuration(charge));
    const bar=panel.querySelector('[data-offline-charge-bar]');if(bar)bar.style.width=`${charge/21600*100}%`;
  }

  function updateHuntTargetBar(target, zone) {
    const hud=root.querySelector('[data-hunt-target-hud]');
    if(!hud)return;
    if(!target||!target.alive||Number(target.hp||0)<=0){
      hud.hidden=true;
      return;
    }
    const monster=(zone?.monsters||[]).find(entry=>String(entry.id||'')===String(target.monsterId||''))||(zone?.monsters||[])[0]||{};
    const maxHp=Math.max(1,Number(target.maxHp||monster.hp||target.hp||1));
    const hp=Math.max(0,Math.min(maxHp,Number(target.hp||0)));
    const pct=Math.max(0,Math.min(100,hp/maxHp*100));
    hud.hidden=false;
    const name=hud.querySelector('[data-target-name]');if(name)name.textContent=monster.name||target.name||'Inimigo';
    const level=hud.querySelector('[data-target-level]');if(level)level.textContent=`Lv. ${Math.max(1,Number(monster.requiredLevel||zone?.level||1))}`;
    const kind=hud.querySelector('[data-target-kind]');if(kind)kind.textContent=monster.isBoss||zone?.contentType==='boss'||zone?.guildBoss?'BOSS':zone?.vipOnly?'VIP':'COMUM';
    const value=hud.querySelector('[data-target-hp-value]');if(value)value.textContent=`${Math.ceil(hp).toLocaleString('pt-BR')} / ${Math.ceil(maxHp).toLocaleString('pt-BR')}`;
    const percent=hud.querySelector('[data-target-hp-percent]');if(percent)percent.textContent=`${Math.floor(pct)}%`;
    const fill=hud.querySelector('[data-target-hp-fill]');if(fill)fill.style.width=`${pct}%`;
    const image=hud.querySelector('[data-target-image]');
    if(image){
      const src=monsterPreviewSource(monster);
      if(image.dataset.src!==src){image.dataset.src=src;image.src=src;}
    }
  }

  function renderHunt(char) {
    const zone = zones.find(z => z.id === state.hunt.zoneId) || zones[0];
    const selectedLure = state.hunt.pendingLureCount ?? state.hunt.lureCount;
    return `
      <div class="hunt-arena-page">
        <div class="hunt-target-hud" data-hunt-target-hud hidden>
          <div class="hunt-target-portrait"><img data-target-image alt="Inimigo"></div>
          <div class="hunt-target-main">
            <div class="hunt-target-title"><strong data-target-name>Inimigo</strong><span data-target-kind>COMUM</span><b data-target-level>Lv. 1</b></div>
            <div class="hunt-target-hp"><i data-target-hp-fill></i><em data-target-hp-value>0 / 0</em><b data-target-hp-percent>0%</b></div>
          </div>
        </div>
        ${(zone.questType==='progression'&&String(zone.progressionQuestId||'')===String(ensureProgressionQuestState(state).activeQuestId||''))?`<div class="quest-time-hud"><span>⏱ QUEST</span><strong data-quest-countdown>${formatQuestCountdown(progressionQuestRemainingMs(state))}</strong><small>5:00 para concluir</small></div>`:''}
        ${(zone.contentType==='boss'||zone.guildBoss)?`<div class="boss-time-hud"><span>⏱ BOSS</span><strong data-boss-countdown>${formatQuestCountdown(zone.guildBoss?Math.max(0,guildBossFightDeadlineAt-Date.now()):Math.max(0,Number(state.hunt?.bossDeadlineAt||0)-Date.now()))}</strong><small>5:00 para derrotar</small></div>`:''}
        ${(zone.guildBoss||partyState?.activeContent)?(()=>{const tank=zone.guildBoss?guildBossTankStatus:partyTankStatus;return `<div class="guild-boss-tank-hud ${String(tank?.tankId||'')===String(state.profile.id)?'self-tank':''}"><span>🛡 TANK ATUAL</span><strong>${escapeHtml(tank?.tankName||'Aguardando...')}</strong><div><i style="width:${Math.max(0,Math.min(100,Number(tank?.hpPercent||0)))}%"></i><em>${Math.max(0,Number(tank?.hp||0)).toLocaleString('pt-BR')} / ${Math.max(1,Number(tank?.maxHp||1)).toLocaleString('pt-BR')}</em></div></div>`})():''}
        <div class="hunt-current-zone">
          <div class="hunt-zone-title">
            <strong>${zone.name}</strong>
            <span>${zone.recommended || `Nível ${zone.level}+`}</span>
          </div>
          <div class="hunt-zone-actions">
            <button class="hunt-switch-inline"
              data-action="switch-hunt"
              title="Escolher outra Hunt sem interromper a atual">
              TROCAR HUNT
            </button>
            <button class="hunt-stop-inline"
              data-action="request-stop-hunt">
              PARAR HUNT
            </button>
          </div>
        </div>

        <div class="hunt-combat-toolbar">
          <div class="hunt-toolbar-section lure-control">
            <label for="hunt-lure-select">Próximo lure</label>
            <select id="hunt-lure-select">
              ${allowedLureCounts(zone).map(count =>
                `<option value="${count}" ${selectedLure === count ? 'selected' : ''}>
                  ${count}
                </option>`
              ).join('')}
            </select>
          </div>
          <div class="hunt-toolbar-section loot-control">
            <button class="loot-config-button" data-action="open-loot-config">
              LOOT
            </button>
            <button class="hunt-analyser-button ${huntAnalyserOpen?'active':''}" data-action="toggle-hunt-analyser">
              ANALYSER
            </button>
          </div>
          <div class="hunt-toolbar-section skill-slots spell-hotbar">
            <div class="spell-toolbar-heading">
              <span class="toolbar-label">Ataques</span>
              <button class="spellbar-settings"
                data-action="clear-spell-bar"
                title="Limpar todos os ataques">×</button>
            </div>
            <div class="spell-slot-grid">
              ${Array.from({length:4}, (_, index) => {
                const spellId = state.settings.spellBar.slots[index];
                const assignedSpell = allSpellsForCategory('attack').find(entry =>
                  entry.id === spellId
                ) || null;
                const previewSpell = spellId
                  ? null
                  : lockedAttackPreviewForSlot(index);
                const spell = assignedSpell || previewSpell;
                const lockInfo = spell ? spellLockInfo(spell) : null;
                const locked = Boolean(lockInfo?.locked);
                const preview = Boolean(previewSpell);
                const enabled =
                  state.settings.spellBar.enabled[index] !== false;
                const usable = Boolean(assignedSpell) && !locked && enabled;
                const title = spell
                  ? lockInfo.title
                  : `Slot de ataque ${index + 1}`;

                return `<div class="spell-slot-shell
                    ${spell ? 'assigned' : 'empty'}
                    ${locked ? 'locked-spell' : ''}
                    ${preview ? 'future-spell-preview' : ''}
                    ${enabled ? '' : 'disabled-spell'}">
                  <button class="spell-cast-button"
                    data-cast-spell-slot="${index}"
                    data-spell-id="${usable ? spell.id : ''}"
                    title="${escapeHtml(title)}"
                    ${usable ? '' : 'disabled'}>
                    ${spell
                      ? `<img src="${spell.icon}" alt="${escapeHtml(spell.name)}">
                         ${locked ? `<span class="spell-level-lock"><i>🔒</i><em>${escapeHtml(lockInfo.label)}</em></span>` : ''}
                         ${!locked ? `<span class="spell-cooldown-overlay"
                           data-spell-cooldown="${spell.id}" hidden></span>` : ''}`
                      : `<span>${index + 1}</span>`}
                    <b>${index + 1}</b>
                  </button>
                  <button class="spell-config-button"
                    data-configure-spell-slot="${index}"
                    title="Escolher spell">⚙</button>
                  <label class="spell-auto-toggle">
                    <input type="checkbox"
                      data-spell-auto-slot="${index}"
                      ${state.settings.spellBar.auto[index] ? 'checked' : ''}
                      ${usable ? '' : 'disabled'}>
                    <span>AUTO</span>
                  </label>
                </div>`;
              }).join('')}
            </div>
          </div>

          <div class="hunt-toolbar-section consumable-slots">
            <span class="toolbar-label">Consumíveis</span>
            ${renderAutoConsumable('hp','server_12775','HP')}
            ${renderAutoConsumable('ki','server_12776','KI')}
            ${renderAutoConsumable('senzu','senzu','SZ')}
          </div>

          <div class="hunt-toolbar-section support-spell-slots">
            <span class="toolbar-label">Suporte</span>
            <div class="support-slot-row">
              ${[
                ['buff','BUFF'],
                ['speed','SPEED'],
                ['aggro','AGRO'],
                ['healing','CURA']
              ].map(([kind,label]) => {
                const configuredSpell = configuredSupportSpell(kind);
                const previewSpell = configuredSpell
                  ? null
                  : nextLockedSpell(kind);
                const spell = configuredSpell || previewSpell;
                const lockInfo = spell ? spellLockInfo(spell) : null;
                const locked = Boolean(lockInfo?.locked);
                const usableSpell = configuredSpell && !locked
                  ? configuredSpell
                  : null;
                const auto =
                  state.settings.spellBar.support[kind].auto === true;
                const title = spell ? lockInfo.title : label;
                return `<div class="support-spell-shell
                    ${spell ? '' : 'empty'}
                    ${locked ? 'locked-spell' : ''}
                    ${previewSpell ? 'future-spell-preview' : ''}">
                  <button class="support-spell-button"
                    data-cast-support-spell="${kind}"
                    data-spell-id="${usableSpell?.id || ''}"
                    title="${escapeHtml(title)}"
                    ${locked ? 'disabled' : ''}>
                    ${spell
                      ? `<img src="${spell.icon}" alt="${escapeHtml(spell.name)}">
                         ${locked ? `<span class="spell-level-lock"><i>🔒</i><em>${escapeHtml(lockInfo.label)}</em></span>` : ''}
                         ${!locked ? `<span class="spell-cooldown-overlay"
                           data-spell-cooldown="${spell.id}" hidden></span>` : ''}`
                      : `<span>${label}</span>`}
                  </button>
                  ${kind==='aggro'
                    ? '<span class="support-spell-fixed" title="Slot fixo manual">🔒</span>'
                    : `<button class="support-spell-config"
                        data-configure-support-spell="${kind}"
                        title="Escolher spell">⚙</button>`}
                  <label class="support-auto-toggle">
                    <input type="checkbox"
                      data-support-auto="${kind}"
                      ${auto ? 'checked' : ''}
                      ${usableSpell && kind!=='aggro' ? '' : 'disabled'}>
                    <span>${kind==='aggro'?'MANUAL':'AUTO'}</span>
                  </label>
                  ${kind === 'healing' ? `
                    <select class="support-heal-threshold"
                      data-support-heal-threshold>
                      ${[25,50,75,90].map(value => `
                        <option value="${value}"
                          ${Number(
                            state.settings.spellBar.support.healing.threshold
                          ) === value ? 'selected' : ''}>
                          ${value}%
                        </option>
                      `).join('')}
                    </select>
                  ` : ''}
                </div>`;
              }).join('')}
            </div>
          </div>

        </div>

        <canvas id="hunt-arena-canvas" class="hunt-arena-canvas"></canvas>
      </div>
    `;
  }




  function renderSpellBook() {
    const isAttack = Number.isInteger(spellBookSlot);
    const category = isAttack
      ? 'attack'
      : String(spellBookSlot || 'status');
    const slot = isAttack ? Number(spellBookSlot) : null;
    const currentId = isAttack
      ? state.settings.spellBar.slots[slot]
      : state.settings.spellBar.support[category]?.spellId;
    const enabled = isAttack
      ? state.settings.spellBar.enabled[slot] !== false
      : true;
    const available = allSpellsForCategory(category);
    const title = isAttack
      ? `Ataque ${slot + 1}`
      : category === 'buff'
        ? 'Spell de Buff'
        : category === 'speed'
          ? 'Spell de Speed'
          : category === 'healing'
            ? 'Spell de Cura'
            : 'Spell de Status';

    return `
      <div class="hunt-modal-backdrop spell-book-backdrop">
        <section class="spell-book-panel">
          <header>
            <div>
              <h2>${title}</h2>
              <small>
                ${isAttack
                  ? 'Técnicas ofensivas. As futuras aparecem bloqueadas até o level necessário.'
                  : 'Spells compatíveis. As futuras aparecem bloqueadas até o level necessário.'}
              </small>
            </div>
            <button data-action="close-spell-book">×</button>
          </header>

          ${isAttack ? `
            <div class="spell-rotation-settings">
              <label class="spell-enable-toggle">
                <input type="checkbox" data-spell-slot-enabled="${slot}"
                  ${enabled ? 'checked' : ''}>
                <span>Spell ativa neste slot</span>
              </label>
              <label>
                <span>Usar no mínimo com</span>
                <select data-spell-min-targets="${slot}">
                  ${[1,2,3,4,5].map(value => `
                    <option value="${value}"
                      ${Number(
                        state.settings.spellBar.minTargets[slot]
                      ) === value ? 'selected' : ''}>
                      ${value}+ criatura${value === 1 ? '' : 's'}
                    </option>
                  `).join('')}
                </select>
              </label>
            </div>
          ` : ''}

          <div class="spell-book-grid">
            <button class="spell-book-card clear
                ${currentId ? '' : 'selected'}"
              data-assign-spell="">
              <strong>Remover spell</strong>
              <small>Deixar o slot vazio</small>
            </button>
            ${available.map(spell => {
              const lockInfo=spellLockInfo(spell);
              const locked = lockInfo.locked;
              return `
              <button class="spell-book-card
                  ${spell.id === currentId ? 'selected' : ''}
                  ${locked ? 'locked' : ''}"
                ${locked ? 'disabled' : `data-assign-spell="${spell.id}"`}
                title="${escapeHtml(lockInfo.title)}">
                <span class="spell-book-icon-wrap">
                  <img src="${spell.icon}" alt="${escapeHtml(spell.name)}">
                  ${locked ? '<i class="spell-book-lock-icon">🔒</i>' : ''}
                </span>
                <strong>${escapeHtml(spell.name)}</strong>
                <small class="${locked ? 'spell-unlock-level' : ''}">
                  ${locked ? `🔒 ${escapeHtml(lockInfo.label)}` : `Level ${spell.level}`} ·
                  ${spellKiCostLabel(spell)}
                </small>
                <span>
                  ${spell.targetMode === 'area'
                    ? `Área · ${spell.areaCells || 1} células`
                    : spell.runtimeKind === 'healing'
                      ? 'Cura'
                      : spell.runtimeKind === 'condition'
                        ? 'Condição'
                        : spell.runtimeKind === 'damage'
                          ? 'Ataque'
                          : 'Suporte'}
                  · ${spell.hitCount} hit${spell.hitCount === 1 ? '' : 's'}
                  · ${(spell.cooldownMs / 1000).toFixed(1)}s
                </span>
              </button>`;
            }).join('')}
          </div>
        </section>
      </div>
    `;
  }

  function consumablesFor(kind) {
    return Object.values(itemCatalog)
      .filter(item => {
        if (!item || item.type !== 'consumable') return false;
        // itemCatalog.senzu / itemCatalog.senzuKi (fallback icon aliases
        // used by the toolbar's default-item lookups) point at the same
        // underlying serverId as server_12779 — without this they'd show
        // up as a second, identical "Senzu Bean" entry in every picker.
        if (item.id === 'senzu') return false;
        if (kind === 'hp') {
          return Number(item.restoreHp || 0) > 0 &&
            item.consumableKind !== 'senzu';
        }
        if (kind === 'ki') {
          return Number(item.restoreKi || 0) > 0 &&
            item.consumableKind !== 'senzu';
        }
        return item.consumableKind === 'senzu';
      })
      .filter((item,index,array) =>
        array.findIndex(candidate => candidate.id === item.id) === index
      )
      .sort((a,b) => {
        const aValue = kind === 'hp'
          ? Number(a.restoreHp || 0)
          : kind === 'ki'
            ? Number(a.restoreKi || 0)
            : Math.max(
                Number(a.restoreHp || 0),
                Number(a.restoreKi || 0)
              );
        const bValue = kind === 'hp'
          ? Number(b.restoreHp || 0)
          : kind === 'ki'
            ? Number(b.restoreKi || 0)
            : Math.max(
                Number(b.restoreHp || 0),
                Number(b.restoreKi || 0)
              );
        return aValue - bValue;
      });
  }

  function consumableKindTitle(kind) {
    if (kind === 'hp') return 'Curas de HP';
    if (kind === 'ki') return 'Potions de Ki';
    if (kind === 'senzu') return 'Senzu automático (HP ou Ki)';
    return 'Senzus';
  }

  function consumableRestoreLabel(item, kind) {
    if (kind === 'hp') {
      return `+${Number(item.restoreHp || 0).toLocaleString('pt-BR')} HP`;
    }
    if (kind === 'ki') {
      return `+${Number(item.restoreKi || 0).toLocaleString('pt-BR')} Ki`;
    }
    return `+${Number(item.restoreHp || 0).toLocaleString('pt-BR')} HP/Ki`;
  }

  function bestAvailableSenzu() {
    return consumablesFor('senzu')
      .filter(item => itemQuantity(state,item.id) > 0)
      .filter(item => state.profile.level >= equipmentRequiredLevel(item))
      .sort((a,b) => {
        const aValue = Math.max(Number(a.restoreHp || 0), Number(a.restoreKi || 0), a.restoreFullHp || a.restoreFullKi ? Number.MAX_SAFE_INTEGER : 0);
        const bValue = Math.max(Number(b.restoreHp || 0), Number(b.restoreKi || 0), b.restoreFullHp || b.restoreFullKi ? Number.MAX_SAFE_INTEGER : 0);
        return bValue - aValue;
      })[0] || null;
  }

  function rerenderConsumableConfigPreservingScroll() {
    const listScroll = root.querySelector('.consumable-config-modal .idle-option-list')?.scrollTop || 0;
    const pageScroll = window.scrollY;
    render();
    requestAnimationFrame(() => {
      const list = root.querySelector('.consumable-config-modal .idle-option-list');
      if (list) list.scrollTop = listScroll;
      window.scrollTo({top:pageScroll,left:0,behavior:'auto'});
    });
  }

  function renderConsumableConfig() {
    const kind = consumableConfigOpen;
    const config = state.settings.autoConsumables[kind];
    const items = consumablesFor(kind);
    const autoBest = kind === 'senzu' && config.autoBest === true;
    const selectedId = autoBest ? '__best__' : (config.itemId || null);
    const selected = autoBest ? bestAvailableSenzu() : itemCatalog[selectedId];
    const threshold = Number(config.threshold || 50);
    const thresholdIndex = [25,50,75,90].indexOf(threshold);
    const hpThreshold = Number(config.hpThreshold ?? 75);
    const kiThreshold = Number(config.kiThreshold ?? 75);

    return `
      <div class="idle-modal-backdrop">
        <section class="idle-config-modal consumable-config-modal">
          <button class="idle-modal-close"
            data-action="close-consumable-config">×</button>

          <header class="idle-modal-header">
            <h2>${consumableKindTitle(kind)}
              <em>${selected ? '1' : '0'} / ${items.length}</em>
            </h2>
            <span>Selecione o consumível automático</span>
          </header>

          <div class="idle-selected-row">
            <div>
              <strong>Slot selecionado</strong>
              <small>${autoBest
                ? `Sempre usar o melhor${selected ? ` · Atual: ${escapeHtml(selected.name)}` : ' · Nenhum disponível'}`
                : selected ? escapeHtml(selected.name) : 'Nenhum consumível selecionado'}</small>
            </div>
            <button data-action="clear-consumable-slot">
              LIMPAR SLOT
            </button>
          </div>

          ${kind === 'senzu' ? `
          <div class="idle-threshold-row">
            <div><strong>Usar quando vida ≤</strong><small>Gatilho de HP do mesmo Senzu.</small></div>
            <select data-senzu-threshold="hpThreshold">${[25,50,75,90].map(v=>`<option value="${v}" ${v===hpThreshold?'selected':''}>${v}%</option>`).join('')}</select>
          </div>
          <div class="idle-threshold-row">
            <div><strong>Ou quando Ki ≤</strong><small>Gatilho de Ki do mesmo Senzu.</small></div>
            <select data-senzu-threshold="kiThreshold">${[25,50,75,90].map(v=>`<option value="${v}" ${v===kiThreshold?'selected':''}>${v}%</option>`).join('')}</select>
          </div>` : `
          <div class="idle-threshold-row">
            <div>
              <strong>Usar quando ${kind === 'ki' ? 'Ki' : 'vida'} ≤</strong>
              <small>Controle o ponto de ativação automática.</small>
            </div>
            <div class="idle-stepper">
              <button data-threshold-step="-1" ${thresholdIndex <= 0 ? 'disabled' : ''}>−</button>
              <b>${threshold}%</b>
              <button data-threshold-step="1" ${thresholdIndex >= 3 ? 'disabled' : ''}>+</button>
            </div>
          </div>`}

          <div class="idle-option-list">
            ${kind === 'senzu' ? `
            <button class="idle-option-card ${autoBest ? 'selected' : ''}"
              data-select-consumable="__best__">
              <span class="idle-off-icon">AUTO</span>
              <span>
                <strong>Sempre usar o melhor</strong>
                <small>Escolhe o Senzu mais forte disponível e troca automaticamente quando acabar.</small>
              </span>
              <b>${autoBest ? 'SELECIONADO' : ''}</b>
            </button>` : ''}
            <button class="idle-option-card off-option
                ${!selectedId ? 'selected' : ''}"
              data-select-consumable="">
              <span class="idle-off-icon">OFF</span>
              <span>
                <strong>Não usar</strong>
                <small>Nunca consumir automaticamente</small>
              </span>
              ${!selectedId ? '<b>SELECIONADO</b>' : ''}
            </button>

            ${items.map(item => {
              const owned = itemQuantity(state,item.id);
              const requiredLevel = equipmentRequiredLevel(item);
              const locked = state.profile.level < requiredLevel;
              return `
                <button class="idle-option-card
                    ${selectedId === item.id ? 'selected' : ''}
                    ${locked ? 'locked' : ''}"
                  data-select-consumable="${item.id}"
                  ${locked ? 'disabled' : ''}>
                  <span class="idle-item-icon">${itemVisual(item)}</span>
                  <span>
                    <strong>${escapeHtml(item.name)}</strong>
                    <small>
                      Nível ${requiredLevel} ·
                      ${consumableRestoreLabel(item,kind)} ·
                      Possui ${owned}
                    </small>
                  </span>
                  <b>${locked
                    ? `REQUER NÍVEL ${requiredLevel}`
                    : selectedId === item.id
                      ? 'SELECIONADO'
                      : ''}</b>
                </button>`;
            }).join('')}
          </div>

          <footer class="idle-modal-footer">
            <button data-action="confirm-consumable-config">
              CONCLUIR
            </button>
          </footer>
        </section>
      </div>`;
  }

  function renderAutoConsumable(configId,itemId,fallback){
    const config=state.settings.autoConsumables[configId];
    const autoBest = configId === 'senzu' && config.autoBest === true;
    const bestSenzu = autoBest ? bestAvailableSenzu() : null;
    const selected=bestSenzu?.id || config.itemId || itemId;
    const item=itemCatalog[selected];
    const quantity=item ? itemQuantity(state,selected) : 0;
    const enabled = config.enabled === true;

    return `<div class="auto-consumable modern-consumable-slot
        ${enabled ? 'auto-enabled' : ''}">
      <button class="combat-slot consumable ${quantity ? '' : 'empty'}"
        data-quick-consumable="${selected || ''}"
        data-tooltip-item="${item?.id || ''}"
        ${item && quantity ? '' : 'disabled'}>
        ${item ? itemVisual(item) : `<span>${fallback}</span>`}
        ${configId==='senzu'?'<span class="consumable-cooldown-overlay" data-senzu-cooldown hidden></span>':''}
        <b data-quick-count="${selected || ''}">${quantity}</b>
        <i>${configId === 'senzu' ? `${autoBest ? 'MELHOR · ' : ''}HP ${Number(config.hpThreshold ?? 75)}% · KI ${Number(config.kiThreshold ?? 75)}%` : `${Number(config.threshold || 50)}%`}</i>
      </button>
      <button class="consumable-config-button"
        data-open-consumable-config="${configId}"
        title="Configurar ${fallback}">+</button>
      <label class="modern-auto-switch">
        <input type="checkbox" data-auto-consumable="${configId}"
          ${enabled ? 'checked' : ''}>
        <span>AUTO</span>
      </label>
    </div>`;
  }


  function areaLootItems() {
    const zone = zones.find(entry => entry.id === state.hunt.zoneId)
      || zones[0];
    const ids = new Set();
    for (const monster of zone.monsters) {
      for (const drop of monster.loot || []) {
        ids.add(`server_${drop.serverId}`);
      }
    }
    return [...ids]
      .map(id => itemCatalog[id])
      .filter(Boolean);
  }


  function npcSellUnitPrice(item){
    if(!item)return 0;
    const explicit=Number(item.sellPrice??item.value??0);
    if(explicit>0)return Math.floor(explicit);
    const base={common:10,uncommon:35,rare:120,epic:450,legendary:1500};
    const rarity=String(item.rarity||'common').toLowerCase();
    const power=Object.entries(item.stats||{}).reduce(
      (sum,[key,value])=>key==='skillBonuses'||typeof value!=='number'
        ?sum:sum+Math.abs(value),0
    );
    return Math.max(1,Math.floor((base[rarity]||10)+power*2+Number(item.requiredLevel||0)*.25));
  }
  function vendorEntries(){
    const entries=[];
    for(const container of inventoryContainers(state)){
      container.items.forEach((entry,index)=>{
        const item=itemCatalog[entry.itemId];
        if(!item||item.type==='currency'||isNpcSaleBlocked(item)||entry.containerId)return;
        const unitPrice=npcSellUnitPrice(item);
        if(unitPrice>0)entries.push({container,entry,index,item,unitPrice});
      });
    }
    return entries;
  }
  function sellableEntries(){
    return vendorEntries().filter(({entry})=>!entry.locked);
  }

  function renderRebornNpc() {
    const quest = ensureRebornQuestState();
    const char = characters[state.profile.characterId];
    const current = currentTransformationForm(state,char);
    const currentVocation = Number(
      state.profile.vocationSourceId || current?.vocationId || 0
    );
    const choices = rebornChoicesFor(state,char,rebornVocationMap);
    const level = Number(state.profile.level || 1);
    const validLevel = level >= rebornQuest.minimumLevel && level <= rebornQuest.maximumLevel;
    const hasReadyChoice = choices.some(choice => choice.available && choice.entryForm);
    const canChoose = quest.readyForReborn && !quest.completed && validLevel && hasReadyChoice;
    const permanentPath = String(state.profile.rebornPath || '');
    const choiceCards = choices.length ? choices.map(choice => {
      const form = choice.entryForm;
      const enabled = canChoose && choice.available && form;
      return `
        <article class="reborn-path-card ${choice.path === 'superReborn' ? 'super-reborn' : ''}">
          <div class="reborn-path-preview">
            ${form?.portrait ? `<img src="${form.portrait}" alt="${choice.label}">` : ''}
          </div>
          <div>
            <small>CAMINHO</small>
            <strong>${choice.label}</strong>
            <span>Level 1 · lookType ${form?.lookType || '—'}</span>
          </div>
          <button class="reborn-action" data-action="confirm-reborn" data-reborn-path="${choice.path}" ${enabled?'':'disabled'}>
            ESCOLHER ${choice.label.toUpperCase()}
          </button>
        </article>`;
    }).join('') : '';

    return `
      <div class="hunt-modal-backdrop reborn-npc-backdrop">
        <section class="reborn-npc-panel" role="dialog" aria-modal="true" aria-label="NPC Reborn">
          <header>
            <div>
              <span class="reborn-npc-kicker">FINAL DA QUEST</span>
              <h2>Reborn</h2>
            </div>
            <button data-action="close-reborn">×</button>
          </header>
          <div class="reborn-npc-content">
            <div class="reborn-npc-portrait">
              <img src="./assets/generated/exact-transformations/portraits/307.png" alt="NPC Reborn">
            </div>
            <div class="reborn-npc-copy">
              <p>Conclua a quest na última forma Normal e escolha o caminho disponível para este personagem.</p>
              <div class="reborn-npc-rules">
                <span>Level permitido <b>${rebornQuest.minimumLevel}–${rebornQuest.maximumLevel}</b></span>
                <span>Quest <b>${quest.readyForReborn ? 'Completa' : 'Incompleta'}</b></span>
                <span>Forma Normal final <b>${hasReadyChoice ? 'Pronta' : 'Necessária'}</b></span>
              </div>
              ${permanentPath ? `
                <p class="reborn-vocation-preview">Caminho permanente: <strong>${permanentPath === 'superReborn' ? 'Super Reborn' : 'Reborn'}</strong></p>` : ''}
              ${choices.length ? `
                <p class="reborn-permanent-warning"><b>ATENÇÃO:</b> a escolha é permanente neste personagem. Depois de confirmar, não será possível trocar entre Reborn e Super Reborn.</p>
              ` : `
                <p class="reborn-warning">Você precisa estar na última transformação da sua vocação para rebornar.</p>`}
            </div>
          </div>
          ${choiceCards ? `<div class="reborn-path-options">${choiceCards}</div>` : ''}
          <footer>
            <button data-action="close-reborn">Agora não</button>
          </footer>
        </section>
      </div>`;
  }

  function renderVendor() {
    const entries = vendorEntries();
    return `
      <div class="hunt-modal-backdrop">
        <section class="vendor-panel">
          <header>
            <div>
              <h2>Bulma Compradora</h2>
              <small>Compra todos os itens do Absolute em um único NPC.</small>
            </div>
            <button data-action="close-vendor">×</button>
          </header>
          <div class="vendor-list">
            ${entries.length ? entries.map(({container,entry,index,item}) => `
              <div class="vendor-row ${entry.locked ? 'sale-locked' : ''}" data-tooltip-item="${item.id}">
                ${itemVisual(item)}
                <span><strong>${escapeHtml(item.name)}</strong>
                  <small>${entry.quantity}× · ${entry.locked ? 'PROTEGIDO · ' : ''}${item.priceSource === 'npc'
                    ? 'Preço original dos NPCs'
                    : 'Preço derivado pela raridade'}</small></span>
                <b>${npcSellUnitPrice(item) * entry.quantity} z</b>
                <button class="vendor-lock-button ${entry.locked ? 'locked' : ''}"
                  data-toggle-sale-lock="${container.id}:${index}:${item.id}:${entry.instanceId||''}"
                  title="${entry.locked ? 'Desproteger da venda' : 'Proteger contra Vender tudo'}">
                  ${entry.locked ? '🔒' : '🔓'}
                </button>
                <button data-sell-item="${container.id}:${index}" ${entry.locked ? 'disabled' : ''}>Vender</button>
              </div>`).join('') : '<p>Nenhum item vendável na backpack.</p>'}
          </div>
          <footer>
            <button data-action="sell-all">Vender tudo</button>
            <button data-action="close-vendor">Fechar</button>
          </footer>
        </section>
      </div>`;
  }

  function sellEntry(containerId,index){
    const current=state.containers?.[containerId]?.items?.[Number(index)];
    if(current?.locked){
      log('Item protegido. Remova o cadeado na loja antes de vender.');
      return false;
    }
    if(socket.connected){
      const item=itemCatalog[current?.itemId];
      if(!current||!item||isNpcSaleBlocked(item))return false;
      socket.sendGameAction('sell',{itemId:current.itemId,instanceId:current.instanceId||null,quantity:Number(current.quantity||1)});
      return 'pending';
    }
    const removed=removeEntryAt(state,containerId,index);
    if(!removed)return false;
    const item=itemCatalog[removed.itemId];
    if(!item||isNpcSaleBlocked(item)){
      restoreEntryAt(state,containerId,index,removed);return false;
    }
    const unitPrice=npcSellUnitPrice(item);
    if(unitPrice<=0){restoreEntryAt(state,containerId,index,removed);return false;}
    const total=unitPrice*Number(removed.quantity||1);
    state.profile.bank=Number(state.profile.bank||0)+total;
    socket?.sendGameAction('sell',{itemId:removed.itemId,quantity:Number(removed.quantity||1)});
    log(`${removed.quantity}× ${item.name} vendido por ${total.toLocaleString('pt-BR')} Gold.`);
    return true;
  }

  function renderLootConfig() {
    const ignored = new Set(state.hunt.lootFilter?.ignored || []);
    return `
      <div class="hunt-modal-backdrop">
        <section class="loot-config-panel" role="dialog" aria-modal="true">
          <header>
            <div>
              <h2>Configuração de Loot</h2>
              <small>Itens marcados não serão recolhidos automaticamente.</small>
            </div>
            <button data-action="close-loot-config">×</button>
          </header>
          <div class="loot-config-list">
            ${areaLootItems().map(item => `
              <label class="${ignored.has(item.id) ? 'ignored' : ''}"
                data-tooltip-item="${item.id}">
                ${itemVisual(item)}
                <span>
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${ignored.has(item.id)
                    ? 'Deixar no corpo'
                    : item.type === 'currency'
                      ? 'Enviar ao banco'
                      : 'Pegar automaticamente'}</small>
                </span>
                <input type="checkbox"
                  data-loot-ignore="${item.id}"
                  ${ignored.has(item.id) ? 'checked' : ''}
                  ${item.type === 'currency' ? 'disabled' : ''}>
              </label>
            `).join('')}
          </div>
          <footer>
            <button data-action="close-loot-config">Concluir</button>
          </footer>
        </section>
      </div>
    `;
  }

  function renderStopHuntConfirm() {
    return `<div class="hunt-modal-backdrop"><section class="stop-hunt-confirm" role="dialog" aria-modal="true"><h2>Parar a Hunt?</h2><p>Ao confirmar, a caça será encerrada e o personagem retornará ao PZ.</p><div><button data-action="cancel-stop-hunt">Não</button><button class="danger" data-action="confirm-stop-hunt">Sim, parar</button></div></section></div>`;
  }


  function monsterPreviewSource(monster) {
    if (monster?.huntPreview) {
      return `${monster.huntPreview}?v=2018`;
    }
    if (monster?.lookType) {
      return `./generated/web/absolute-monsters-png/${monster.lookType}.png`;
    }
    if (monster?.sprite) return monster.sprite;
    if (monster?.portrait) return monster.portrait;
    return './assets/generated/outfits/goku.png';
  }

  function monsterImage(monster, className='') {
    return `<img class="${className} sprite-loading"
      src="${monsterPreviewSource(monster)}"
      onload="this.classList.remove('sprite-loading')"
      onerror="this.onerror=null;this.src='./assets/generated/outfits/goku.png?v=2018'"
      alt="${escapeHtml(monster?.name || 'Criatura')}">`;
  }

  function isBossMonster(monster) {
    return false;
  }

  function zoneContentKind(zone) {
    return zone.disabledForHunt ? 'excluded' : 'hunts';
  }

  function hasVipAccess(zone) {
    if (!zone?.vipOnly) return true;
    return Number(state.profile?.vipUntil || 0) > Date.now();
  }

  function zonesForTab(tab) {
    const byEntryLevel=(a,b)=>Number(a.level||1)-Number(b.level||1)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    if(tab==='bosses')return zones.filter(zone=>!zone.hiddenFromHuntList&&zone.contentType==='boss'&&Array.isArray(zone.monsters)&&zone.monsters.length>0).sort(byEntryLevel);
    if (tab !== 'hunts') return [];
    return zones.filter(zone =>
      !zone.hiddenFromHuntList &&
      !zone.disabledForHunt &&
      zone.questType !== 'reborn' && zone.contentType!=='boss' &&
      Array.isArray(zone.monsters) &&
      zone.monsters.length > 0
    ).sort(byEntryLevel);
  }


  function huntLootItems(zone) {
    const ids = new Set();
    for (const monster of zone.monsters || []) {
      for (const drop of monster.loot || []) {
        const id = drop.itemId || (
          drop.serverId ? `server_${drop.serverId}` : null
        );
        if (id) ids.add(id);
      }
    }
    return [...ids].map(id => itemCatalog[id]).filter(Boolean);
  }

  function huntMapPreview(zone) {
    const floor = String(zone.floor || zone.environment || '').toLowerCase();
    if (floor.includes('snow')) return 'linear-gradient(135deg,#dbe6ec,#7896a8)';
    if (floor.includes('desert')) return 'linear-gradient(135deg,#d7b56c,#7d522a)';
    if (floor.includes('namek')) return 'linear-gradient(135deg,#6fa55b,#2b5f55)';
    if (floor.includes('lava')) return 'linear-gradient(135deg,#561610,#e04814)';
    return 'linear-gradient(135deg,#314b2d,#17231b)';
  }

  function activeProgressionQuestDefinition(){
    const q=ensureProgressionQuestState(state);
    return progressionQuestsV212.find(entry=>String(entry.id)===String(q.activeQuestId||''))||null;
  }
  function formatQuestCountdown(ms=0){const total=Math.max(0,Math.ceil(Number(ms||0)/1000));return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}
  function expireLocalProgressionQuest(){
    if(!ensureProgressionQuestState(state).activeQuestId)return false;
    hunt.stop();abandonProgressionQuest(state);resetToEarth(state);restoreInPz();activeView='world';huntContentTab='quests';huntChooserOpen=true;
    log('⏱ O tempo de 5 minutos da Quest acabou. Você voltou ao PZ e deverá iniciar a missão novamente do começo.');persist();render();return true;
  }


  function finishLocalProgressionQuest(quest){
    const progress=ensureProgressionQuestState(state);
    if(!quest||String(progress.activeQuestId||'')!==String(quest.id||''))return false;
    const exit=findQuestTile(quest,'E');
    if(!exit||Number(progress.x)!==Number(exit.x)||Number(progress.y)!==Number(exit.y))return false;
    if(!(quest.guards||[]).every(g=>progress.clearedGuards.includes(Number(g.index))))return false;
    if(quest.rewardItemId){
      const rewardItem=itemCatalog[quest.rewardItemId];
      const meta=isRarityEligibleItem(rewardItem)?{rarity:rollItemRarity().id,source:'quest'}:null;
      const added=addItemToInventory(state,quest.rewardItemId,1,itemCatalog,null,meta);
      if(!added?.ok){log('Libere espaço na Backpack para receber a recompensa.');return false;}
    }
    markProgressionQuestComplete(state,quest.id);
    state.completedQuests ||= [];
    if(!state.completedQuests.includes(quest.id))state.completedQuests.push(quest.id);
    if(quest.unlockVocationId){
      state.profile.unlockedVocations=Array.isArray(state.profile.unlockedVocations)?state.profile.unlockedVocations:[];
      if(!state.profile.unlockedVocations.includes(quest.unlockVocationId))state.profile.unlockedVocations.push(quest.unlockVocationId);
    }
    log(`${quest.name} concluída: ${quest.rewardName}.`);
    activeView='world';huntContentTab='quests';huntChooserOpen=true;
    persist();render();return true;
  }

  function localStartProgressionQuest(questId){
    const quest=progressionQuestsV212.find(entry=>String(entry.id)===String(questId||''));
    const result=startProgressionQuest(state,quest);
    if(!result.ok){log(result.message);return false;}
    log('⏱ Você tem 5 minutos para concluir a Quest. Se o tempo acabar, voltará ao PZ e terá que recomeçar.');
    hunt.stop();training.stop();activeView='quest-expedition';huntChooserOpen=false;persist();render();return true;
  }

  function localMoveProgressionQuest(dx,dy){
    const quest=activeProgressionQuestDefinition();
    const result=moveProgressionQuest(state,quest,dx,dy);
    if(result.guard){
      const zone=zones.find(entry=>entry.id===String(result.zoneId||''));
      if(!zone){log('Guardião da Quest não encontrado.');return false;}
      hunt.setZone(zone.id,1);activeView='hunt';huntChooserOpen=false;hunt.start();persist();render();return true;
    }
    if(!result.ok){if(result.timeout){expireLocalProgressionQuest();return false;}if(result.message)log(result.message);return false;}
    if(result.complete)return finishLocalProgressionQuest(quest);
    persist();render();return true;
  }

  function progressionQuestStartStatus(quest){
    const q=ensureProgressionQuestState(state);
    if(q.completed.includes(String(quest.id)))return {locked:true,label:'CONCLUÍDA',reason:'Recompensa já obtida'};
    if(Number(state.profile.level||1)<Number(quest.level||1))return {locked:true,label:`REQUER LV ${quest.level}`,reason:'Level insuficiente'};
    if(quest.vipOnly&&!hasVipAccess({vipOnly:true}))return {locked:true,label:'APENAS PARA VIPS',reason:'Conta VIP necessária'};
    if(partyState&&!partyState.isLeader)return {locked:true,label:'AGUARDE O LÍDER',reason:'Na Party, somente o líder inicia a Quest'};
    return {locked:false,label:'INICIAR EXPEDIÇÃO',reason:`${quest.guards.length} guardiões · ${partyState?'Party':'Solo'} · recompensa única`};
  }

  function renderProgressionQuestExpedition(char){
    const progress=ensureProgressionQuestState(state),quest=activeProgressionQuestDefinition();
    if(!quest)return `<div class="quest-expedition-missing"><h2>Expedição encerrada</h2><p>Volte à aba Quests para escolher outra missão.</p></div>`;
    const cleared=new Set((progress.clearedGuards||[]).map(Number));
    const leader=!partyState||Boolean(partyState?.isLeader),reward=itemCatalog[quest.rewardItemId];
    const rewardVisual=reward?`<span class="quest-reward-tooltip-target" data-tooltip-item="${escapeHtml(reward.id)}">${itemVisual(reward)}</span>`:'🎁';
    const exit=findQuestTile(quest,'E');
    const rows=quest.map.map((row,y)=>`<div class="quest-expedition-row">${[...row].map((tile,x)=>{
      const isPlayer=Number(progress.x)===x&&Number(progress.y)===y;
      const guard=questGuardAt(quest,x,y);const guardCleared=guard&&cleared.has(Number(guard.index));
      const cls=tile==='#'?'wall':tile==='E'?'exit':guard?'guard':'floor';
      return `<span class="quest-expedition-tile ${cls} ${guardCleared?'cleared':''}" title="${guard?escapeHtml(guard.name):tile==='E'?'Baú final':''}">${isPlayer?`<img src="${characterPortrait(char)}" alt="Você">`:guard?(guardCleared?'✓':'💀'):tile==='E'?'🎁':''}</span>`;
    }).join('')}</div>`).join('');
    const guardDone=cleared.size,allGuards=(quest.guards||[]).length;
    return `<div class="quest-expedition-screen">
      <section class="quest-expedition-map-panel"><header><div><small>QUEST DE PROGRESSÃO</small><h2>${escapeHtml(quest.name)}</h2><p>Use WASD ou as setas. Solo você controla a expedição; em Party o líder move o grupo e os guardiões são compartilhados.</p><div class="quest-expedition-timer">⏱ Tempo restante: <strong data-quest-countdown>${formatQuestCountdown(progressionQuestRemainingMs(state))}</strong></div></div><button data-action="stop-progression-expedition" ${leader?'':'disabled'}>Encerrar</button></header>
        <div class="quest-expedition-map">${rows}</div>
        <div class="quest-expedition-controls"><button data-quest-move="0,-1" ${leader?'':'disabled'}>▲</button><div><button data-quest-move="-1,0" ${leader?'':'disabled'}>◀</button><button data-quest-move="0,1" ${leader?'':'disabled'}>▼</button><button data-quest-move="1,0" ${leader?'':'disabled'}>▶</button></div></div>
      </section>
      <aside class="quest-expedition-info"><h3>OBJETIVO</h3><p>Atravesse o mapa e derrote todos os guardiões antes de alcançar o baú final.</p><div class="quest-expedition-progress"><span>Guardiões <b>${guardDone}/${allGuards}</b></span><span>Saída <b>${exit?`${exit.x},${exit.y}`:'—'}</b></span><span>Controle <b>${!partyState?'Solo':leader?'Líder':'Seguindo líder'}</b></span></div><h3>RECOMPENSA</h3><div class="quest-reward-card">${quest.vocationQuest?`<img class="quest-vocation-logo" src="${escapeHtml(quest.questLogo||characters[quest.unlockVocationId]?.sprite||'./assets/generated/outfits/goku.png')}" alt="${escapeHtml(quest.rewardName)}">`:rewardVisual}<div><strong>${escapeHtml(quest.rewardName)}</strong><small>${quest.vocationQuest?'Vocação permanente na conta':'Passe o mouse no item para ver os atributos'}</small></div></div>${quest.vipOnly?'<div class="hunt-vip-warning">Quest exclusiva VIP.</div>':''}<p class="quest-expedition-tip">${quest.vocationQuest?'Esta vocação só é liberada por esta Quest individual de level 1500+.':'Itens de progressão não caem aleatoriamente nas Hunts. Esta recompensa é obtida ao concluir a expedição.'}</p></aside>
    </div>`;
  }

  function renderQuestCards() {
    const rebornState = ensureRebornQuestState();
    const stageIndex = currentRebornStageIndex();
    const stage = rebornQuestStages[stageIndex];
    const zone = stage ? zones.find(entry => entry.id === stage.id) : null;
    const boss = zone?.monsters?.[0];
    const status = rebornState.completed
      ? 'CONCLUÍDA'
      : rebornState.readyForReborn
        ? 'NPC REBORN LIBERADO'
        : `ETAPA ${Math.min(Number(rebornState.stage || 0) + 1, rebornQuestStages.length)} / ${rebornQuestStages.length}`;
    const allEntries=[{kind:'reborn'},...progressionQuestsV212.map(quest=>({kind:'progression',quest}))];
    const tabs=[
      ['all','TODAS',allEntries.length],
      ['reborn','REBORN',1],
      ['items','ITENS',progressionQuestsV212.filter(q=>!q.vocationQuest).length],
      ['vocations','VOCAÇÕES',progressionQuestsV212.filter(q=>q.vocationQuest).length]
    ];
    const entries=allEntries.filter(row=>{
      if(questTab==='all')return true;
      if(questTab==='reborn')return row.kind==='reborn';
      if(row.kind!=='progression')return false;
      if(questTab==='vocations')return Boolean(row.quest?.vocationQuest);
      return !row.quest?.vocationQuest;
    });
    const perPage=4;
    const pageCount=Math.max(1,Math.ceil(entries.length/perPage));
    questPage=Math.max(0,Math.min(pageCount-1,Number(questPage)||0));
    const pageEntries=entries.slice(questPage*perPage,questPage*perPage+perPage);
    const cards=pageEntries.map(row=>{
      if(row.kind==='reborn')return `<button class="quest-choice-card reborn-quest-card ${rebornState.completed?'completed':''}"
          data-reborn-quest-choice>
          <span class="reborn-quest-kicker">QUEST ORIGINAL</span>
          ${boss ? monsterImage(boss,'hunt-card-monster') : ''}
          <strong>Quest Reborn</strong>
          <span class="reborn-quest-status">${status}</span>
          <small>Entrada Lv ${rebornQuest.minimumLevel}–${rebornQuest.maximumLevel} · Dificuldade Lv ${rebornQuest.difficultyLevel}</small>
          <p>Derrote os ${rebornQuestStages.length} bosses em sequência. Conteúdo preparado para grupo (${rebornQuest.recommendedPartySize} jogadores).</p>
          <div class="reborn-level-warning">⚠ Se ultrapassar o level ${rebornQuest.maximumLevel}, a Quest Reborn fica bloqueada. Para fazê-la, será necessário morrer até retornar ao level ${rebornQuest.maximumLevel}.</div>
        </button>`;
      const entry=row.quest,gate=progressionQuestStartStatus(entry),reward=itemCatalog[entry.rewardItemId];
      const vocation=entry.vocationQuest?characters[entry.unlockVocationId]:null;
      const logo=entry.vocationQuest
        ? `<img class="quest-vocation-logo" src="${escapeHtml(entry.questLogo||vocation?.sprite||'./assets/generated/outfits/goku.png')}" alt="${escapeHtml(vocation?.name||entry.rewardName)}">`
        : (reward?`<span class="quest-reward-tooltip-target" data-tooltip-item="${escapeHtml(reward.id)}">${itemVisual(reward)}</span>`:'🎁');
      return `<article class="quest-choice-card progression-quest-card ${gate.locked?'locked':''} ${entry.vipOnly?'vip':''} ${entry.vocationQuest?'vocation-quest':''}">
        <span class="reborn-quest-kicker">${entry.vocationQuest?'QUEST DE VOCAÇÃO · LV 1500+':entry.vipOnly?'QUEST VIP':'EXPEDIÇÃO'}</span>
        <div class="progression-quest-reward">${logo}</div>
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="reborn-quest-status">LV ${entry.level}+ · ${entry.guards.length} GUARDIÕES</span>
        <small>Recompensa: ${escapeHtml(entry.rewardName)}</small>
        ${entry.vocationQuest?`<small class="quest-vocation-reward">🔓 Desbloqueio permanente da vocação ${escapeHtml(vocation?.name||entry.unlockVocationId)} na conta</small>`:''}
        <p>${escapeHtml(entry.description)}</p>
        <button data-progression-quest-start="${entry.id}" ${gate.locked?'disabled':''}>${gate.label}</button>
        <em>${escapeHtml(gate.reason)}</em>
      </article>`;
    }).join('');
    const pageNav=`<nav class="quest-page-nav quest-page-nav-inline">
      <button data-quest-page="${Math.max(0,questPage-1)}" ${questPage<=0?'disabled':''}>‹ Anterior</button>
      <span>Página <b>${questPage+1}</b> de <b>${pageCount}</b></span>
      <button data-quest-page="${Math.min(pageCount-1,questPage+1)}" ${questPage>=pageCount-1?'disabled':''}>Próxima ›</button>
    </nav>`;
    return `<div class="quest-selection-shell">
      <div class="quest-toolbar-row">
        <nav class="quest-category-tabs">${tabs.map(([id,label,count])=>`<button data-quest-tab="${id}" class="${questTab===id?'active':''}">${label}<small>${count}</small></button>`).join('')}</nav>
        ${pageNav}
      </div>
      <div class="quest-selection-grid paged-quest-grid">${cards||'<p class="quest-empty-state">Nenhuma quest nesta categoria.</p>'}</div>
      ${pageCount>1?pageNav:''}
    </div>`;
  }

  function renderRebornQuestDetail(selected) {
    const quest = ensureRebornQuestState();
    const stageIndex = currentRebornStageIndex();
    const currentStage = rebornQuestStages[stageIndex];
    const currentBoss = selected?.monsters?.[0] || currentRebornZone()?.monsters?.[0];
    const locked = Number(state.profile.level || 1) < rebornQuest.minimumLevel ||
      Number(state.profile.level || 1) > rebornQuest.maximumLevel;
    const actionLabel = quest.completed
      ? 'QUEST CONCLUÍDA'
      : quest.readyForReborn
        ? 'IR AO NPC REBORN'
        : quest.started
          ? `CONTINUAR · ${currentStage?.name || 'QUEST'}`
          : 'INICIAR QUEST REBORN';
    return `
      <div class="hunt-detail-backdrop" data-action="close-hunt-detail-backdrop">
        <section class="hunt-detail-overlay reborn-quest-detail" role="dialog" aria-modal="true">
          <div class="hunt-detail-hero reborn-quest-hero"
            style="background:${huntMapPreview(selected)}">
            <span class="reborn-hero-badge">REBORN</span>
            ${currentBoss ? monsterImage(currentBoss,'reborn-current-boss') : ''}
          </div>
          <div class="hunt-detail-body">
            <h2>Quest Reborn</h2>
            <div class="hunt-level-tags">
              <span>ENTRADA <b>Lv ${rebornQuest.minimumLevel}+</b></span>
              <span>DIFICULDADE <b>Lv ${rebornQuest.difficultyLevel}</b></span>
              <span>GRUPO ALVO <b>${rebornQuest.recommendedPartySize}</b></span>
              <span>BOSSES <b>${rebornQuestStages.length}</b></span>
            </div>
            <p class="reborn-description">
              A sequência segue a quest original: ao derrotar um boss, o próximo é liberado automaticamente.
              O combate foi calibrado para level ${rebornQuest.difficultyLevel} e futuro uso em party; personagens abaixo disso sofrem desvantagem de level.
              Depois de Porunga, você será levado para a área do NPC Reborn.
            </p>
            <div class="reborn-level-warning detail">⚠ Regra importante: a Quest Reborn só aceita personagens entre os levels ${rebornQuest.minimumLevel} e ${rebornQuest.maximumLevel}. Se você ultrapassar o level ${rebornQuest.maximumLevel}, não poderá iniciar/concluir a quest até morrer e voltar ao level ${rebornQuest.maximumLevel}.</div>
            <div class="reborn-stage-list">
              ${rebornQuestStages.map((stage,index) => {
                const done = quest.completed || index < Number(quest.stage || 0);
                const current = !quest.completed && !quest.readyForReborn && index === stageIndex;
                return `<div class="reborn-stage ${done?'done':''} ${current?'current':''}">
                  <b>${String(index + 1).padStart(2,'0')}</b>
                  <span>${escapeHtml(stage.name)}</span>
                  <i>${done?'✓':current?'▶':'•'}</i>
                </div>`;
              }).join('')}
            </div>
            ${quest.readyForReborn ? `
              <div class="reborn-final-hint">
                Porunga derrotado. NPC Reborn: ${rebornQuest.rebornNpc.x}, ${rebornQuest.rebornNpc.y}, ${rebornQuest.rebornNpc.z}. O portal em ${rebornQuest.exitTeleport.x}, ${rebornQuest.exitTeleport.y}, ${rebornQuest.exitTeleport.z} retorna ao templo.
              </div>` : ''}
            <button class="confirm-hunt modern reborn-confirm"
              data-action="confirm-hunt"
              ${quest.completed || locked ? 'disabled' : ''}>
              ${locked
                ? `REQUER LEVEL ${rebornQuest.minimumLevel}–${rebornQuest.maximumLevel}`
                : actionLabel}
            </button>
          </div>
        </section>
      </div>`;
  }


  function renderPartyPanel(){
    const members=partyState?.members||[];
    return `<div class="party-backdrop"><section class="party-panel" role="dialog" aria-modal="true">
      <header><div><span>GRUPO</span><h2>Party</h2><p>Opcional para Quests e Bosses. Hunts comuns continuam solo.</p></div><button data-party-close>×</button></header>
      ${partyMessage?`<div class="party-message">${escapeHtml(partyMessage)}</div>`:''}
      ${!partyState?`<div class="party-empty"><strong>Você não está em uma Party.</strong><p>Você pode fazer Bosses e Quests sozinho. Crie uma Party quando quiser jogar em grupo.</p><button data-party-create>Criar Party</button></div>`:`
        <div class="party-rules"><span>👑 Líder: <b>${escapeHtml(members.find(m=>m.leader)?.name||'—')}</b></span><span>👥 ${members.length}/${partyState.maxMembers||5}</span><span>🎟️ Boss: ticket somente do líder</span></div>
        <div class="party-members">${members.map(m=>`<article class="${m.leader?'leader':''}"><div><b>${m.leader?'👑 ':''}${escapeHtml(m.name)}</b><small>Lv ${m.level||'?'} · ${m.online?'Online':'Offline'}</small></div>${partyState.isLeader&&!m.leader?`<div class="party-member-actions"><button data-party-transfer="${escapeHtml(m.id)}" ${m.online?'':'disabled'}>Passar liderança</button><button class="danger" data-party-kick="${escapeHtml(m.id)}">Remover</button></div>`:''}</article>`).join('')}</div>
        ${partyState.isLeader?`<div class="party-invite-box"><h3>Convidar jogador</h3><div class="party-name-invite"><input data-party-invite-name type="text" maxlength="16" placeholder="Nome exato do personagem"><button data-party-invite>Convidar</button></div><small>Sua lista de Amigos agora fica em uma janela separada no topo.</small></div>`:''}
        ${partyState.activeContent?`<div class="party-active"><b>Em andamento:</b> ${escapeHtml(zones.find(z=>z.id===partyState.activeContent.zoneId)?.name||progressionQuestsV212.find(q=>q.id===partyState.activeContent.questId)?.name||partyState.activeContent.zoneId||'Expedição')} · conteúdo compartilhado</div>`:''}
        <footer><button class="danger" data-party-leave>${partyState.isLeader?'Encerrar Party':'Sair da Party'}</button></footer>`}
    </section></div>`;
  }

  function renderFriendsPanel(){
    const members=partyState?.members||[];
    const names=Array.isArray(state.profile?.friends)?state.profile.friends:[];
    const friends=names.map(name=>{const online=presence.find(p=>String(p.name||'').toLowerCase()===String(name||'').toLowerCase());return {name,online:Boolean(online),level:Number(online?.level||0),inParty:members.some(m=>String(m.name||'').toLowerCase()===String(name||'').toLowerCase())};}).sort((a,b)=>Number(b.online)-Number(a.online)||String(a.name).localeCompare(String(b.name),'pt-BR'));
    const friendNotice=friendsMessage?.text?`<div class="friends-message ${friendsMessage.ok?'success':'error'}" role="status">${escapeHtml(friendsMessage.text)}</div>`:'';
    return `<div class="party-backdrop friends-backdrop"><section class="party-panel friends-panel" role="dialog" aria-modal="true"><header><div><span>SOCIAL</span><h2>Amigos</h2><p>Lista permanente, independente da Party.</p></div><button data-friends-close>×</button></header>
      <div class="friends-add-row"><input data-friend-add-name type="text" maxlength="16" placeholder="Adicionar pelo nome do personagem"><button data-friend-add>Adicionar</button></div>
      ${friendNotice}
      <div class="party-friends-list standalone"><b>${friends.length}/50 amigo(s)</b>${friends.length?friends.map(f=>`<article><span>${f.online?'🟢':'⚫'} <strong>${escapeHtml(f.name)}</strong>${f.online?` · Lv ${f.level||1}`:' · Offline'}</span><div>${partyState?.isLeader&&f.online&&!f.inParty?`<button data-party-invite-friend="${escapeHtml(f.name)}">Convidar para Party</button>`:''}<button class="subtle" data-friend-remove="${escapeHtml(f.name)}">Remover</button></div></article>`).join(''):'<small>Nenhum amigo adicionado.</small>'}</div>
      <footer><small>Limite: 50 amigos por conta. ${partyState?.isLeader?'Você pode convidar amigos online diretamente daqui.':'Crie uma Party para habilitar convites em grupo.'}</small></footer>
    </section></div>`;
  }


  function renderPlayerContextMenu(){
    const target=playerContextTarget||{};
    return `<div class="player-context-backdrop" data-player-context-close><section class="player-context-card" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
      <button class="player-context-close" data-player-context-close>×</button>
      <div class="player-context-portrait"><img src="${escapeHtml(target.sprite||'./assets/generated/outfits/goku.webp')}" alt=""></div>
      <h3>${escapeHtml(target.name||'Jogador')}</h3><p>Lv ${Number(target.level||1)}</p>
      <div class="player-context-actions"><button data-player-profile="${escapeHtml(target.profileId||'')}">Perfil</button><button data-player-trade="${escapeHtml(target.profileId||'')}">Trade</button><button class="primary" data-player-pvp="${escapeHtml(target.profileId||'')}">⚔ PvP</button></div>
      ${tradeMessage?`<small>${escapeHtml(tradeMessage)}</small>`:''}
      ${pvpMessage?`<small>${escapeHtml(pvpMessage)}</small>`:''}
    </section></div>`;
  }

  function profileEquipmentCard(profile,slot){
    const rawId=profile?.equipment?.[slot];
    const base=rawId?itemCatalog[rawId]:null;
    const item=base?rarityAdjustedItem(base,profile?.equipmentMeta?.[slot]):null;
    return `<article class="profile-equipment-slot ${item?`rarity-${item.rarity||'common'}`:'empty'}" ${item?`data-tooltip-item="${escapeHtml(item.id)}" data-tooltip-rarity="${escapeHtml(item.rarity||'common')}" data-tooltip-slot="${escapeHtml(slot)}"`:''}>
      <small>${escapeHtml(slotNames[slot]||slot)}</small>${item?`${itemVisual(item)}<b>${escapeHtml(item.name)}</b>`:'<span>—</span>'}
    </article>`;
  }

  function selfCharacterProfileData(){
    const p=state.profile||{};
    const char=characters[p.characterId]||characters.goku;
    const form=currentTransformationForm(state,char);
    return {
      id:String(p.id||''),
      name:String(p.name||'Jogador'),
      characterId:String(p.characterId||'goku'),
      formId:String(p.formId||''),
      vocationSourceId:Number(p.vocationSourceId||0),
      level:Math.max(1,Number(p.level||1)),
      sprite:String(form?.portrait||char?.sprite||characterPortrait(char)||'./assets/generated/outfits/goku.webp'),
      profileIcon:p.profileIcon||'default',
      profileBorder:p.profileBorder||'default',
      unlockedProfileIcons:[...new Set(['default',...(p.unlockedProfileIcons||[])])],
      unlockedProfileBorders:[...new Set(['default',...(p.unlockedProfileBorders||[])])],
      isSelf:true,
      alliance:p.guild?{name:String(p.guild.name||''),tag:String(p.guild.tag||''),role:String(p.guild.role||'member')}:null,
      tournamentsWon:Math.max(0,Number(p.tournamentsWon||0)),
      pvpWins:Math.max(0,Number(p.pvpWins||0)),
      pvpLosses:Math.max(0,Number(p.pvpLosses||0)),
      bestiaryPoints:bestiaryEarnedPoints(state),
      bossBestiaryPoints:bossBestiaryEarnedPoints(state),
      equipment:{...structuredClone(state.equipment||{}),backpack:state.containers?.[state.equipment?.backpack]?.itemId||null},
      equipmentMeta:structuredClone(state.equipmentMeta||{})
    };
  }

  function renderProfilePaperdoll(profile){
    const positions=['helmet','necklace','backpack','armor','weapon','offhand','legs','boots','ring','ammo'];
    return `<div class="classic-paperdoll profile-paperdoll"><div class="mini-character"><img src="${escapeHtml(profile.sprite||'./assets/generated/outfits/goku.webp')}" alt=""></div>${positions.map(slot=>{const rawId=profile?.equipment?.[slot],base=rawId?itemCatalog[rawId]:null,item=base?rarityAdjustedItem(base,profile?.equipmentMeta?.[slot]):null;return `<div class="classic-equip slot-${slot==='offhand'?'shield':slot} ${item?'occupied':''}" ${item?`data-tooltip-item="${escapeHtml(item.id)}" data-tooltip-rarity="${escapeHtml(item.rarity||'common')}" data-tooltip-slot="${escapeHtml(slot)}"`:''}>${item?`${itemVisual(item)}<small>${escapeHtml(item.name)}</small>`:`<span class="slot-placeholder">${slotIcon(slot)}</span>`}</div>`;}).join('')}</div>`;
  }

  function profileIconAsset(id='default'){
    return String(id)==='beta'?'./assets/ui/v2114/beta-profile-icon.png':'./assets/ui/v2120/default-profile-icon.jpg';
  }
  function profileBorderAsset(id='default'){
    return String(id)==='beta'?'./assets/ui/v2114/beta-profile-border.png?v=21.24.5':null;
  }
  function renderProfileCosmeticPicker(p){
    if(!p?.isSelf||!profileCosmeticPicker)return '';
    const kind=profileCosmeticPicker==='border'?'border':'icon';
    const values=kind==='icon'?[...new Set(['default',...(p.unlockedProfileIcons||[])])]:[...new Set(['default',...(p.unlockedProfileBorders||[])])];
    const selected=kind==='icon'?String(p.profileIcon||'default'):String(p.profileBorder||'default');
    return `<div class="profile-cosmetic-picker-backdrop"><section class="profile-cosmetic-picker"><header><div><small>COSMÉTICOS DA CONTA</small><h3>${kind==='icon'?'Alterar ícone':'Alterar borda'}</h3></div><button data-profile-cosmetic-close>×</button></header><p>Somente cosméticos já liberados nesta conta aparecem aqui.</p><div class="profile-cosmetic-options">${values.map(id=>{const active=String(id)===selected;if(kind==='icon')return `<button class="profile-cosmetic-option ${active?'active':''}" data-profile-cosmetic-select="icon|${escapeHtml(id)}"><span class="profile-icon-frame cosmetic-border-default"><img class="profile-main-cosmetic-icon" src="${profileIconAsset(id)}" alt="${escapeHtml(id)}"></span><b>${id==='default'?'Padrão':id==='beta'?'Beta Exclusivo':escapeHtml(id)}</b>${active?'<em>Em uso</em>':''}</button>`;const asset=profileBorderAsset(id);return `<button class="profile-cosmetic-option ${active?'active':''}" data-profile-cosmetic-select="border|${escapeHtml(id)}"><span class="profile-border-choice ${id==='default'?'generic-black':''}">${asset?`<img src="${asset}" alt="${escapeHtml(id)}">`:'<i></i>'}</span><b>${id==='default'?'Preta Padrão':id==='beta'?'Beta Exclusiva':escapeHtml(id)}</b>${active?'<em>Em uso</em>':''}</button>`;}).join('')}</div></section></div>`;
  }

  function renderCharacterProfile(){
    const p=characterProfileData||{};
    const alliance=p.alliance?.name?`${p.alliance.name}${p.alliance.tag?` [${p.alliance.tag}]`:''}`:'Sem Aliança';
    const border=String(p.profileBorder||'default').replace(/[^a-z0-9_-]/gi,'').toLowerCase()||'default';
    const iconSrc=profileIconAsset(p.profileIcon||'default'),borderSrc=profileBorderAsset(border);
    const mainPanel=profileTab==='equipment'
      ? `<main class="profile-summary profile-equipment-original"><h3>Equipamentos</h3>${renderProfilePaperdoll(p)}</main>`
      : `<main class="profile-summary profile-overview-only"><div class="profile-facts"><article><span>Nível</span><b>${Number(p.level||1)}</b></article><article><span>Aliança</span><b>${escapeHtml(alliance)}</b></article><article><span>Torneios vencidos</span><b>${Number(p.tournamentsWon||0)}</b></article><article class="pvp-win-stat"><span>Vitórias PvP</span><b>${Number(p.pvpWins||0).toLocaleString('pt-BR')}</b></article><article class="pvp-loss-stat"><span>Derrotas PvP</span><b>${Number(p.pvpLosses||0).toLocaleString('pt-BR')}</b></article></div><section class="profile-bestiary-summary"><h3>Bestiário</h3><article><span>Pontos conquistados</span><b>${Number(p.bestiaryPoints||0).toLocaleString('pt-BR')} / ${bestiaryMaximumPoints(bestiaryMonsterCatalog().length).toLocaleString('pt-BR')}</b></article><h3>Bestiário de Boss</h3><article><span>Pontos conquistados</span><b>${Number(p.bossBestiaryPoints||0).toLocaleString('pt-BR')} / ${bossBestiaryMaximumPoints(bestiaryBossCatalog().length).toLocaleString('pt-BR')}</b></article></section></main>`;
    return `<div class="profile-backdrop"><section class="character-profile-window" role="dialog" aria-modal="true">
      <header><div><span>COMUNIDADE</span><h2>Perfil do Jogador</h2></div><button data-profile-close>×</button></header>
      <nav class="character-profile-tabs"><button data-profile-tab="profile" class="${profileTab==='profile'?'active':''}">Perfil</button><button data-profile-tab="equipment" class="${profileTab==='equipment'?'active':''}">Equipamentos</button></nav>
      <div class="character-profile-body">
        <aside class="profile-cosmetics"><div class="profile-icon-frame cosmetic-border-${border}"><img class="profile-main-cosmetic-icon" src="${iconSrc}" alt="Ícone de perfil">${borderSrc?`<img class="profile-cosmetic-border-overlay" src="${borderSrc}" alt="Borda cosmética">`:''}</div><strong>${escapeHtml(p.name||'Jogador')}</strong>${p.isSelf?`<div class="profile-cosmetic-actions"><button data-profile-cosmetic-open="icon">Alterar ícone</button><button data-profile-cosmetic-open="border">Alterar borda</button></div>`:''}</aside>
        ${mainPanel}
      </div>
      ${renderProfileCosmeticPicker(p)}
    </section></div>`;
  }

  function tradeOfferRows(offer,removable=false){
    const rows=Array.isArray(offer?.items)?offer.items:[];
    if(!rows.length)return '<p class="trade-empty">Nenhum item oferecido.</p>';
    return rows.map(row=>{const item=rarityAdjustedItem(itemCatalog[row.itemId],{rarity:row.rarity||'common'});return `<article class="trade-offer-row">${item?itemVisual(item):'<span>?</span>'}<div><b>${escapeHtml(item?.name||row.itemId)}</b><small>Quantidade: ${Number(row.quantity||1)}</small></div>${removable?`<button data-trade-remove="${escapeHtml(row.key)}">−</button>`:''}</article>`}).join('');
  }

  function renderTradeInvite(){
    const remaining=Math.max(0,Math.ceil((Number(tradeInvite?.expiresAt||Date.now())-Date.now())/1000));
    return `<div class="party-invite-backdrop trade-invite-backdrop"><section class="party-invite-dialog"><b>Convite de Trade</b><p><strong>${escapeHtml(tradeInvite?.fromName||'Jogador')}</strong> quer negociar com você.</p><small>Expira em aproximadamente ${remaining}s.</small><div><button data-trade-decline>Recusar</button><button data-trade-accept>Aceitar</button></div></section></div>`;
  }

  function tradeOfferWithDelta(key,delta){
    if(!tradeState)return;
    const current=new Map((tradeState.ownOffer?.items||[]).map(row=>[String(row.key),{...row}]));
    const inventory=(tradeState.ownInventory||[]).find(row=>String(row.key)===String(key));
    if(!inventory)return;
    const old=Number(current.get(String(key))?.quantity||0),next=Math.max(0,Math.min(Number(inventory.quantity||1),old+delta));
    if(next<=0)current.delete(String(key));else current.set(String(key),{key:String(key),quantity:next});
    socket.sendTradeAction('offer',{offer:{items:[...current.values()],zeni:Number(tradeState.ownOffer?.zeni||0),pp:Number(tradeState.ownOffer?.pp||0)}});
  }

  function renderTradeWindow(){
    const t=tradeState||{},inventory=Array.isArray(t.ownInventory)?t.ownInventory:[];
    const offered=new Map((t.ownOffer?.items||[]).map(row=>[String(row.key),Number(row.quantity||0)]));
    return `<div class="trade-backdrop"><section class="trade-window" role="dialog" aria-modal="true">
      <header><div><span>NEGOCIAÇÃO SEGURA</span><h2>Trade com ${escapeHtml(t.partnerName||'Jogador')}</h2></div><button data-trade-cancel>×</button></header>
      ${tradeMessage?`<div class="trade-message">${escapeHtml(tradeMessage)}</div>`:''}
      <div class="trade-columns">
        <section><h3>Seu inventário</h3><div class="trade-inventory-list">${inventory.length?inventory.map(row=>{const item=rarityAdjustedItem(itemCatalog[row.itemId],{rarity:row.rarity||'common'}),remaining=Math.max(0,Number(row.quantity||0)-Number(offered.get(String(row.key))||0));return `<article>${item?itemVisual(item):'<span>?</span>'}<div><b>${escapeHtml(item?.name||row.itemId)}</b><small>Disponível: ${remaining}/${Number(row.quantity||1)}</small></div><button data-trade-add="${escapeHtml(row.key)}" ${remaining<=0?'disabled':''}>+</button></article>`}).join(''):'<p class="trade-empty">Nenhum item negociável.</p>'}</div></section>
        <section class="trade-offer-panel"><h3>Sua oferta ${t.ownConfirmed?'✓':''}</h3>${tradeOfferRows(t.ownOffer,true)}<div class="trade-currency-offer"><label>Zeni <input data-trade-zeni type="number" min="0" step="1" value="${Number(t.ownOffer?.zeni||0)}"></label><label>PP <input data-trade-pp type="number" min="0" step="1" value="${Number(t.ownOffer?.pp||0)}"></label><button data-trade-currency-apply>Atualizar moedas</button></div></section>
        <section class="trade-offer-panel partner"><h3>Oferta de ${escapeHtml(t.partnerName||'Jogador')} ${t.partnerConfirmed?'✓':''}</h3>${tradeOfferRows(t.partnerOffer,false)}<div class="trade-zeni-readonly">Zeni: <b>${Number(t.partnerOffer?.zeni||0).toLocaleString('pt-BR')}</b> · PP: <b>${Number(t.partnerOffer?.pp||0).toLocaleString('pt-BR')}</b></div></section>
      </div>
      <footer><small>Qualquer alteração na oferta remove as confirmações dos dois jogadores.</small><div><button class="danger" data-trade-cancel>Cancelar</button><button class="primary" data-trade-confirm ${t.ownConfirmed?'disabled':''}>${t.ownConfirmed?'Confirmado · aguardando':'Confirmar Trade'}</button></div></footer>
    </section></div>`;
  }

  function renderPartyInvite(){
    return `<div class="party-invite-backdrop"><section class="party-invite-dialog"><b>Convite para Party</b><p><strong>${escapeHtml(partyInvite?.fromName||'Jogador')}</strong> convidou você para a Party.</p><div><button data-party-decline>Recusar</button><button data-party-accept>Aceitar</button></div></section></div>`;
  }
  function renderGuildBossInvite(){
    const invite=guildBossInvite||{},remaining=Math.max(0,Math.ceil((new Date(invite.startsAt||Date.now()).getTime()-Date.now())/1000));
    const champa=invite.bossType==='champa',portrait=champa?'./assets/generated/vip-portraits/vip-champa-683.png':'./assets/generated/exact-transformations/portraits/758.png';
    return `<div class="party-invite-backdrop guild-boss-invite-backdrop"><section class="party-invite-dialog guild-boss-invite-dialog"><div class="guild-boss-invite-title"><img src="${portrait}" alt="${champa?'Champa':'Daishinkan'}"><div><b>Convite · Boss da Guild</b><strong>${escapeHtml(invite.bossName||(champa?'Champa':'Daishinkan'))}</strong></div></div><p class="guild-boss-warning"><b>ATENÇÃO:</b> ${escapeHtml(invite.warning||'Se todos morrerem, a tentativa será perdida.')}</p><p>${escapeHtml(invite.rewards||'Recompensas especiais de Guild.')}</p><div class="guild-boss-countdown">Início automático em <b>${remaining}s</b></div><div><button data-guild-boss-decline>Recusar</button><button data-guild-boss-accept>Aceitar</button></div></section></div>`;
  }
  function renderGuildBossAcceptedCountdown(){
    const pending=guildBossAcceptedCountdown||{};
    const remaining=Math.max(0,Math.ceil((Number(pending.startsAt||Date.now())-Date.now())/1000));
    return `<div class="guild-boss-ready-countdown" data-guild-boss-ready-countdown><span>⚔ Boss da Guild aceito</span><strong>${escapeHtml(pending.bossName||'Boss da Guild')}</strong><b data-guild-boss-ready-seconds>${remaining>0?`${remaining}s`:'INICIANDO...'}</b><small>Você entrará automaticamente na arena compartilhada.</small></div>`;
  }
  function updateGuildBossAcceptedCountdown(){
    const node=root.querySelector('[data-guild-boss-ready-countdown]');
    if(!node||!guildBossAcceptedCountdown)return;
    const remaining=Math.max(0,Math.ceil((Number(guildBossAcceptedCountdown.startsAt||Date.now())-Date.now())/1000));
    const label=node.querySelector('[data-guild-boss-ready-seconds]');
    if(label)label.textContent=remaining>0?`${remaining}s`:'INICIANDO...';
  }

  function updateGuildBossTauntCooldown(){const el=root.querySelector('[data-guild-taunt-cooldown]');if(!el)return;const rem=Math.max(0,guildBossTauntCooldownUntil-Date.now());el.textContent=rem>0?`${(rem/1000).toFixed(1)}s`:'';el.closest('button')?.toggleAttribute('disabled',rem>0);}

  function renderHuntChooser() {
    const tabZones=zonesForTab(huntContentTab);
    const query = huntSearchQuery.trim().toLowerCase();
    const minLevel=String(huntMinLevel).trim()===''?null:Math.max(1,Number(huntMinLevel)||1);
    const maxLevel=String(huntMaxLevel).trim()===''?null:Math.max(1,Number(huntMaxLevel)||1);
    const filteredZones = tabZones.filter(zone => {
      if (huntFavoritesOnly && !(state.hunt.favoriteZoneIds||[]).includes(zone.id)) return false;
      const entryLevel=Number(zone.level||1);
      if(minLevel!=null && entryLevel<minLevel)return false;
      if(maxLevel!=null && entryLevel>maxLevel)return false;
      if (!query) return true;
      if (zone.name.toLowerCase().includes(query)) return true;
      return (zone.monsters||[]).some(monster => monster.name.toLowerCase().includes(query));
    }).sort((a,b)=>Number(a.level||1)-Number(b.level||1)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));

    const PAGE_SIZE = 15;
    const pageCount = Math.max(1, Math.ceil(filteredZones.length / PAGE_SIZE));
    huntPage = Math.min(Math.max(0, huntPage), pageCount - 1);
    const pageZones = filteredZones.slice(
      huntPage * PAGE_SIZE, huntPage * PAGE_SIZE + PAGE_SIZE
    );

    const selected = pendingHuntZoneId
      ? zones.find(zone => zone.id === pendingHuntZoneId)
      : null;
    const selectedLocked=selected && state.profile.level < selected.level;
    const selectedVipLocked=selected && selected.vipOnly && !hasVipAccess(selected);
    const selectedTicketItem=selected?.bossTicketItemId?itemCatalog[selected.bossTicketItemId]:null;
    const selectedTicketCount=selected?.bossTicketItemId?itemQuantity(state,selected.bossTicketItemId):0;
    const selectedTicketMissing=Boolean(selected?.bossTicketItemId)&&selectedTicketCount<1;
    const loot=selected ? huntLootItems(selected) : [];
    const maxLure=selected ? Math.max(...allowedLureCounts(selected)) : 0;
    const isFavorite = selected &&
      (state.hunt.favoriteZoneIds||[]).includes(selected.id);

    return `
      <div class="hunt-modal-backdrop" data-action="close-hunt-picker-backdrop">
        <section class="hunt-selection-panel hunt-paged"
          role="dialog" aria-modal="true">
          <header>
            <div>
              <span class="hunt-kicker">MODOS DE JOGO</span>
            </div>
            <button data-action="close-hunt-picker">×</button>
          </header>

          <nav class="content-mode-tabs paged-tabs">
            ${[
              ['hunts','🗺️','HUNTS'],
              ['bosses','💀','BOSSES'],
              ['quests','📜','QUESTS']
            ].map(([id,icon,label]) => `
              <button data-hunt-content-tab="${id}"
                class="${huntContentTab===id?'active':''}">
                <i>${icon}</i>${label}
              </button>
            `).join('')}
          </nav>

          ${huntContentTab==='quests' ? renderQuestCards() : `
            <div class="hunt-page-grid">
              ${pageZones.length ? pageZones.map(zone => {
                const locked=state.profile.level < zone.level;
                const vipLocked=zone.vipOnly && !hasVipAccess(zone);
                const monster=[...(zone.monsters||[])].sort(
                  (a,b)=>(Number(a.requiredLevel||0)-Number(b.requiredLevel||0))
                    || (Number(a.hp||0)-Number(b.hp||0))
                )[0] || {name:'Dino',lookType:390};
                const fav = (state.hunt.favoriteZoneIds||[]).includes(zone.id);
                return `<button class="hunt-page-card ${locked?'locked':''} ${vipLocked?'vip-locked':''}"
                  data-hunt-choice="${zone.id}" ${vipLocked?'disabled':''}>
                  ${fav ? '<i class="hunt-card-fav">♥</i>' : ''}
                  ${vipLocked ? '<em class="hunt-card-vip-lock">Apenas para VIPs</em>' : ''}
                  ${zone.bossTicketItemId ? '<em class="hunt-card-ticket">🎟️ Ticket obrigatório</em>' : ''}
                  <strong>${escapeHtml(zone.name)}</strong>
                  ${monsterImage(monster,'hunt-card-monster')}
                  <span>LEVEL ${zone.recommendedLevel || zone.level} · MIN ${zone.level}</span>
                </button>`;
              }).join('') : `
                <p class="hunt-empty-state">Nenhuma hunt encontrada.</p>
              `}
            </div>

            <footer class="hunt-pagination-bar">
              <span class="hunt-total-count">${filteredZones.length} ${huntContentTab==='bosses'?'BOSSES':'HUNTS'}</span>
              <div class="hunt-page-controls">
                <button data-action="hunt-page-prev" ${huntPage===0?'disabled':''}>‹</button>
                <span>${huntPage+1} / ${pageCount}</span>
                <button data-action="hunt-page-next" ${huntPage>=pageCount-1?'disabled':''}>›</button>
              </div>
              <div class="hunt-search-bar hunt-search-filters">
                <button data-action="toggle-hunt-favorites" class="${huntFavoritesOnly?'active':''}">♥</button>
                <input type="text" data-hunt-search data-preserve-focus="hunt-search" placeholder="Buscar hunt ou inimigo" value="${escapeHtml(huntSearchQuery)}">
                <label>Nv <input type="number" min="1" data-hunt-min-level data-preserve-focus="hunt-min-level" placeholder="de" value="${escapeHtml(String(huntMinLevel))}"></label>
                <span>–</span>
                <input type="number" min="1" data-hunt-max-level data-preserve-focus="hunt-max-level" placeholder="até" value="${escapeHtml(String(huntMaxLevel))}">
              </div>
            </footer>
          `}
        </section>

        ${!selected ? '' : selected.questType==='reborn' ? renderRebornQuestDetail(selected) : `
        <div class="hunt-detail-backdrop" data-action="close-hunt-detail-backdrop">
          <section class="hunt-detail-overlay" role="dialog" aria-modal="true">
            <div class="hunt-detail-hero"
              style="background:${huntMapPreview(selected)}">
              <label class="hunt-detail-lure-badge">
                <select data-hunt-detail-lure>
                  ${allowedLureCounts(selected).map(count => `
                    <option value="${count}"
                      ${Number(pendingLureCount)===count?'selected':''}>
                      ${count}
                    </option>`).join('')}
                </select>
              </label>
              <button class="hunt-detail-fav ${isFavorite?'active':''}"
                data-action="toggle-hunt-favorite" data-zone-id="${selected.id}">♥</button>
            </div>
            <div class="hunt-detail-body">
              <h2>${escapeHtml(selected.name)}</h2>
              <div class="hunt-level-tags">
                <span>LEVEL RECOMENDADO <b>${selected.recommendedLevel || selected.level}</b></span>
                <span>LEVEL MÍNIMO <b>${selected.level}</b></span>
                <span>LURE MÁXIMO <b>${maxLure}</b></span>
                ${selected.vipOnly ? '<span>ACESSO <b>VIP</b></span>' : ''}
                ${selected.bossTicketItemId ? `<span>TICKET <b>${selectedTicketCount}x</b></span>` : ''}
              </div>
              ${selectedVipLocked ? '<div class="hunt-vip-warning">Apenas para VIPs. Ative sua conta VIP para entrar nesta Hunt.</div>' : ''}
              ${selected.bossTicketItemId ? `<div class="hunt-ticket-warning">${itemVisual(selectedTicketItem)} <div><b>${escapeHtml(selectedTicketItem?.name||'Ticket do Boss')}</b><small>Solo: você consome 1 ticket. Em Party: somente o líder consome 1 ticket.</small></div></div>` : ''}
              <section class="hunt-detail-section">
                <h3>Criaturas</h3>
                <span class="hunt-detail-hint">Clique na criatura para ver os detalhes</span>
                <div class="hunt-creature-cards">
                  ${(selected.monsters || []).map(monster => `
                    <article>
                      <strong>${escapeHtml(monster.name)}</strong>
                      ${monsterImage(monster)}
                      <small>Lv ${monster.requiredLevel || selected.level}</small>
                    </article>
                  `).join('')}
                </div>
              </section>
              <section class="hunt-detail-section">
                <h3>Loots possíveis</h3>
                <div class="hunt-loot-grid">
                  ${loot.length ? loot.map(item => `
                    <span data-tooltip-item="${item.id}">
                      ${itemVisual(item)}
                    </span>`).join('')
                  : '<small>Nenhum drop catalogado.</small>'}
                </div>
              </section>
              <button class="confirm-hunt modern"
                data-action="confirm-hunt"
                ${selectedVipLocked || selectedLocked || selectedTicketMissing || (isSwitchingToDifferentHunt(selected) && huntSwitchRemainingMs() > 0) ? 'disabled' : ''}>
                ${selectedVipLocked
                  ? 'APENAS PARA VIPS'
                  : selectedTicketMissing
                    ? 'TICKET NECESSÁRIO'
                    : selectedLocked
                    ? `REQUER LEVEL ${selected.level}`
                  : isSwitchingToDifferentHunt(selected)
                    ? (huntSwitchRemainingMs() > 0
                      ? `TROCAR EM ${Math.ceil(huntSwitchRemainingMs() / 1000)}s`
                      : 'TROCAR HUNT')
                    : state.hunt?.running && String(selected.id) === String(state.hunt?.zoneId || '')
                      ? 'HUNT ATUAL'
                      : huntContentTab==='bosses'
                        ? 'INICIAR BOSS'
                        : 'INICIAR HUNT'}
              </button>
            </div>
          </section>
        </div>
        `}
      </div>`;
  }

  function renderFullInventory(char) {
    const slots = Array.from({ length: 36 }, (_, i) => state.inventory[i]);
    const stats = totalStats(state, itemCatalog);
    return `
      <div class="embedded-page inventory-embedded">
        <section class="inventory-details">
          <h1>Inventário e equipamentos</h1>
          <div class="large-paperdoll">
            <img src="${char.sprite}">
            ${equipmentSlots.map(slot => {
              const baseItem = itemCatalog[state.equipment[slot]];
              const item = rarityAdjustedItem(baseItem,state.equipmentMeta?.[slot]);
              return `<button class="large-slot slot-${slot} ${item?`rarity-${item.rarity}`:''}" data-unequip="${item ? slot : ''}">
                ${item ? itemVisual(item) : `<span>${slotIcon(slot)}</span>`}<small>${slotNames[slot]}</small>
              </button>`;
            }).join('')}
          </div>
          <div class="attributes">
            ${Object.entries(stats).map(([key, value]) => `<div><span>${statName(key)}</span><strong>+${value}</strong></div>`).join('')}
          </div>
        </section>
        <section class="full-bag">
          <h2>Backpack principal</h2>
          <div class="full-item-grid">
            ${slots.map((entry, index) => entry ? renderFullItem(entry) : `<div class="full-item empty"><small>${index + 1}</small></div>`).join('')}
          </div>
        </section>
      </div>
    `;
  }

  function renderFullItem(entry) {
    const item = rarityAdjustedItem(itemCatalog[entry.itemId],entry);
    return `<button class="full-item rarity-${item.rarity}" data-item="${item.id}" data-instance-id="${entry.instanceId||''}" data-tooltip-item="${item.id}" data-tooltip-rarity="${item.rarity||'common'}">
      ${itemVisual(item)}<small>${item.name}</small><b>${entry.quantity}</b>
    </button>`;
  }


  const marketRarities = [
    ['common','Comum'],['rare','Raro'],['super_rare','Super Raro'],['epic','Épico'],
    ['legendary','Lendário'],['super_legendary','Super Lendário'],['mythic','Mítico'],['divine','Divino']
  ];
  const marketCategories = [
    ['all','Todos','🧰'],['senzu','Senzus','🫘'],['backpack','Backpacks','🎒'],
    ['helmet','Helmet','🪖'],['armor','Armor','🥋'],['legs','Legs','👖'],['boots','Boots','🥾'],
    ['weapon','Arma','⚔️'],['necklace','Amuletos','📿'],['accessory','Acessórios','💍'],['ammo','Munição','🎯'],['premium-points','Premium Points','🟠']
  ];
  function marketApi(path,options={}){
    // Build estatica: nao existe backend. Sem este curto-circuito, cada painel
    // online (market, guild, ranking, loja VIP, pagamentos) tentaria /api/... ,
    // receberia a pagina de erro do host e exibiria "Erro HTTP 404" ao jogador.
    // Todos os pontos de chamada ja tratam a rejeicao e mostram a mensagem.
    return Promise.reject(new Error('Sistema online: indisponivel nesta versao de demonstracao, que roda sem servidor.'));
    return fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...options})
      .then(async response=>{let body={};try{body=await response.json()}catch{};if(!response.ok)throw new Error(body.message||`Erro HTTP ${response.status}`);return body});
  }
  async function loadMarketData(){
    if(marketLoading||!marketOpen)return;marketLoading=true;marketMessage='';render();
    try{
      const result=await marketApi(`/api/market?characterId=${encodeURIComponent(state.profile.id)}`);
      marketData=result;
      if(result.state?.profile){state.profile={...state.profile,...result.state.profile};}
    }catch(error){marketMessage=error.message;}finally{marketLoading=false;if(marketOpen)render();}
  }
  function ppIconHtml(extra=''){return `<img class="pp-icon ${extra}" src="./assets/ui/v2130/premium-points.png" alt="PP">`}
  function marketCurrencyLabel(value){return value==='premium'?`${ppIconHtml('inline')} Premium Points`:'🪙 Zeni'}
  function marketPrice(value,currency){return `${Number(value||0).toLocaleString('pt-BR')} ${currency==='premium'?'PP':'Zeni'}`}
  function isCapsuleItem(item){
    const name=String(item?.name||'').toLowerCase();
    const id=String(item?.id||'').toLowerCase();
    return item?.type==='capsule'||name.includes('capsule')||name.includes('cápsula')||id.includes('_capsule')||id.includes('capsule_');
  }
  function isMarketSenzu(item){
    const name=String(item?.name||'').toLowerCase();
    return item?.consumableKind==='senzu'||name.includes('senzu')||name.includes('rola bean')||name.includes('coca-cola bean');
  }
  function marketItemTradable(item){
    if(!item||item.id==='depot'||item.type==='currency'||isCapsuleItem(item))return false;
    if(isMarketSenzu(item)||item.type==='backpack')return true;
    return !item.questOnly&&!item.trainingSkill;
  }
  function marketItemCard(itemId,rarity='common'){
    const base=itemCatalog[itemId];if(!base)return `<span class="market-missing-item">${escapeHtml(itemId)}</span>`;
    const item=rarityAdjustedItem(base,{rarity});
    return `<span class="market-item-icon rarity-${rarity}" data-tooltip-item="${itemId}" data-tooltip-rarity="${rarity}">${itemVisual(item)}</span>`;
  }
  function marketCategoryFor(item){if(!item)return 'other';if(isMarketSenzu(item))return 'senzu';if(item.type==='backpack')return 'backpack';if(item.type==='ring')return 'accessory';if(item.id==='premium_points_trade')return 'premium-points';return item.type;}
  function marketInventoryEntries(){
    const result=[];for(const container of Object.values(state.containers||{})){
      for(let index=0;index<(container.items||[]).length;index++){
        const entry=container.items[index],item=itemCatalog[entry.itemId];
        if(!marketItemTradable(item))continue;
        const rarity=String(entry.rarity||item.rarity||'common');
        result.push({containerId:container.id,index,entry,item,rarity,location:container.id===state.depotContainerId?'Depot':'Backpack'});
      }
    }return result;
  }
  function renderMarketNav(){
    const tabs=[['buy','📣','Comprar'],['announce','📋','Anunciar'],['mine','📝','Meus Anúncios'],['requests','🤝','Solicitações'],['history','📜','Histórico']];
    return `<div class="market-tabs">${tabs.map(([id,icon,label])=>`<button data-market-tab="${id}" class="${marketTab===id?'active':''}"><span>${icon}</span>${label}${id==='mine'?` <small>(${marketData?.myListings?.length||0})</small>`:''}</button>`).join('')}</div>`;
  }
  function renderMarketSidebar(){return `<aside class="market-sidebar">${marketCategories.map(([id,label,icon])=>`<button data-market-category="${id}" class="${marketCategory===id?'active':''}"><span>${icon}</span>${label}</button>`).join('')}</aside>`}
  function filteredMarketListings(){
    let rows=[...(marketData?.listings||[])].filter(row=>row.seller_character_id!==state.profile.id&&!isCapsuleItem(itemCatalog[row.item_id]));
    const q=marketSearch.trim().toLowerCase();if(q)rows=rows.filter(row=>String(itemCatalog[row.item_id]?.name||row.item_id).toLowerCase().includes(q));
    if(marketCategory!=='all')rows=rows.filter(row=>marketCategoryFor(itemCatalog[row.item_id])===marketCategory);
    if(marketRarity!=='all')rows=rows.filter(row=>row.rarity===marketRarity);
    if(marketSort==='low')rows.sort((a,b)=>Number(a.price)-Number(b.price));else if(marketSort==='high')rows.sort((a,b)=>Number(b.price)-Number(a.price));else rows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    return rows;
  }
  function renderMarketBuy(){
    const rows=filteredMarketListings();return `<div class="market-body">${renderMarketSidebar()}<section class="market-content"><div class="market-filters"><input data-market-search data-preserve-focus="market-search" value="${escapeHtml(marketSearch)}" placeholder="🔎 Buscar anúncio pelo nome..."><select data-market-sort><option value="recent" ${marketSort==='recent'?'selected':''}>Mais Recentes</option><option value="low" ${marketSort==='low'?'selected':''}>Menor Preço</option><option value="high" ${marketSort==='high'?'selected':''}>Maior Preço</option></select><select data-market-rarity><option value="all">Todas raridades</option>${marketRarities.map(([id,n])=>`<option value="${id}" ${marketRarity===id?'selected':''}>${n}</option>`).join('')}</select></div><h3>◆ Resultados do Mercado <small>${rows.length} anúncio(s)</small></h3><div class="market-grid">${rows.length?rows.map(row=>{const item=itemCatalog[row.item_id]||{};return `<article class="market-card rarity-border-${row.rarity}">${marketItemCard(row.item_id,row.rarity)}<div class="market-card-main"><strong>${escapeHtml(item.name||row.item_id)}</strong><small>${rarityDefinition(row.rarity).name} · ${Number(row.quantity)}x · ${escapeHtml(row.seller_name||'Player')}</small><b>${marketPrice(row.price,row.currency)}<em>/un</em></b></div><button data-market-buy="${row.id}">Comprar</button></article>`}).join(''):'<div class="market-empty">Nenhum anúncio encontrado com estes filtros.</div>'}</div></section></div>`;
  }
  function renderMarketAnnounce(){
    let rows=marketInventoryEntries();if(marketAnnounceRarity!=='all')rows=rows.filter(x=>x.rarity===marketAnnounceRarity);
    const ppBalance=Math.max(0,Number(state.profile.premiumPoints??state.profile.vipCredits??0));
    const ppAvailable=Math.floor(ppBalance/10)*10;
    const ppCard=marketAnnounceRarity==='all'||marketAnnounceRarity==='common'?`<article class="market-inventory-card market-pp-asset-card">${marketItemCard('premium_points_trade','common')}<div><strong>Premium Points</strong><small>Saldo: ${ppBalance.toLocaleString('pt-BR')} PP · lotes de 10 · preço por 1 PP</small></div><span class="market-virtual-tag">GLOBAL</span><button data-market-open-pp-announce ${ppAvailable<10?'disabled':''}>Anunciar PP</button></article>`:'';
    return `<section class="market-content market-wide"><div class="market-section-head"><div><h3>◆ Itens disponíveis para anunciar</h3><small>Backpacks, Depot e Premium Points · PP somente de 10 em 10</small></div><select data-market-announce-rarity><option value="all">Todas raridades</option>${marketRarities.map(([id,n])=>`<option value="${id}" ${marketAnnounceRarity===id?'selected':''}>${n}</option>`).join('')}</select></div><div class="market-inventory-grid">${ppCard}${rows.map(({containerId,index,entry,item,rarity,location})=>`<article class="market-inventory-card ${entry.locked?'locked':''}">${marketItemCard(item.id,rarity)}<div><strong>${escapeHtml(item.name)}</strong><small>${rarityDefinition(rarity).name} · ${location} · ${Number(entry.quantity||1)}x</small></div><button class="market-lock" title="${entry.locked?'Desbloquear':'Bloquear'}" data-market-lock="${containerId}|${index}|${item.id}|${entry.instanceId||''}">${entry.locked?'🔒':'🔓'}</button><button data-market-open-announce="${containerId}|${index}" ${entry.locked?'disabled':''}>Anunciar</button></article>`).join('')||(!ppCard?'<div class="market-empty">Nenhum item disponível.</div>':'')}</div></section>`;
  }
  function renderMarketMine(){const rows=marketData?.myListings||[];return `<section class="market-content market-wide"><h3>◆ Meus Anúncios</h3><div class="market-list">${rows.length?rows.map(row=>`<article>${marketItemCard(row.item_id,row.rarity)}<div><strong>${escapeHtml(itemCatalog[row.item_id]?.name||row.item_id)}</strong><small>${Number(row.quantity)}x · expira ${new Date(row.expires_at).toLocaleString('pt-BR')}</small></div><b>${marketPrice(row.price,row.currency)}/un</b><button data-market-cancel-listing="${row.id}">Cancelar</button></article>`).join(''):'<div class="market-empty">Você não tem anúncios ativos.</div>'}</div><p class="market-note">Cancelar antes dos 7 dias devolve o item, mas a taxa de 2% é perdida. Se o anúncio expirar, item e taxa retornam ao personagem.</p></section>`}
  function renderMarketRequests(){
    const reqs=marketData?.requests||[];
    const tradable=Object.values(itemCatalog).filter(marketItemTradable).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));
    return `<section class="market-content market-wide"><h3>◆ Criar Solicitação de Compra</h3><form class="market-request-form" data-market-request-form><select name="itemId" data-market-request-item required><option value="">— escolha o item —</option>${tradable.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}</select><select name="rarity" data-market-request-rarity>${marketRarities.map(([id,n])=>`<option value="${id}">${n}</option>`).join('')}</select><input name="quantity" data-market-request-quantity type="number" min="1" max="9999" value="1" title="Quantidade"><input name="price" type="number" min="1" value="100" title="Preço por unidade"><select name="currency" data-market-request-currency><option value="zeni">Zeni</option><option value="premium">Premium Points</option></select><button>Criar solicitação</button></form><p class="market-note">O valor total fica em custódia. <b>Premium Points:</b> compra e venda somente em múltiplos de 10, sempre com preço definido por 1 PP e pagamento em Zeni.</p><h3>◆ Solicitações Abertas</h3><div class="market-list">${reqs.map(r=>`<article>${marketItemCard(r.item_id,r.rarity)}<div><strong>${escapeHtml(itemCatalog[r.item_id]?.name||r.item_id)}</strong><small>${rarityDefinition(r.rarity).name} · quer ${r.remaining_quantity}/${r.quantity} · ${escapeHtml(r.buyer_name||'Player')}${r.item_id==='premium_points_trade'?' · lotes de 10':''}</small></div><b>${marketPrice(r.unit_price,r.currency)}/un</b>${r.buyer_character_id===state.profile.id?`<button data-market-cancel-request="${r.id}">Cancelar</button>`:`<button data-market-sell-request="${r.id}">Vender</button>`}</article>`).join('')||'<div class="market-empty">Não há solicitações abertas.</div>'}</div></section>`;
  }
  function renderMarketHistory(){let rows=[...(marketData?.history||[])];if(marketHistoryFilter==='bought')rows=rows.filter(r=>r.buyer_character_id===state.profile.id);if(marketHistoryFilter==='sold')rows=rows.filter(r=>r.seller_character_id===state.profile.id);return `<section class="market-content market-wide"><div class="market-section-head"><h3>◆ Histórico</h3><select data-market-history-filter><option value="all">Todos</option><option value="bought" ${marketHistoryFilter==='bought'?'selected':''}>Comprados</option><option value="sold" ${marketHistoryFilter==='sold'?'selected':''}>Vendidos</option></select></div><div class="market-list history">${rows.map(r=>{const bought=r.buyer_character_id===state.profile.id;return `<article>${marketItemCard(r.item_id,r.rarity)}<div><strong>${bought?'🛒 Comprou':'💰 Vendeu'} ${Number(r.quantity)}x ${escapeHtml(itemCatalog[r.item_id]?.name||r.item_id)}</strong><small>${new Date(r.created_at).toLocaleString('pt-BR')} · ${rarityDefinition(r.rarity).name}</small></div><b>${marketPrice(r.unit_price,r.currency)}/un</b></article>`}).join('')||'<div class="market-empty">Nenhuma negociação no histórico.</div>'}</div></section>`}
  function renderMarket(){
    const body=marketLoading?'<div class="market-loading">Carregando Mercado Global...</div>':marketTab==='buy'?renderMarketBuy():marketTab==='announce'?renderMarketAnnounce():marketTab==='mine'?renderMarketMine():marketTab==='requests'?renderMarketRequests():renderMarketHistory();
    return `<div class="market-shell"><header class="market-header"><div class="market-logo"><img src="./assets/ui/v2130/market.png" alt=""></div><div><h1>MERCADO GLOBAL</h1><p>Compre, venda e negocie com jogadores de todo o mundo.</p></div><div class="market-balances"><span>🪙 ${Number(state.profile.bank||0).toLocaleString('pt-BR')} Zeni</span><span>${ppIconHtml('inline')} ${Number(state.profile.premiumPoints??state.profile.vipCredits??0).toLocaleString('pt-BR')} PP</span></div><button data-action="close-market" class="market-close">×</button></header>${renderMarketNav()}${marketMessage?`<div class="market-toast">${escapeHtml(marketMessage)}</div>`:''}${body}</div>`;
  }
  function marketPromptListing(containerId,index){
    const entry=state.containers?.[containerId]?.items?.[Number(index)];
    const item=itemCatalog[entry?.itemId];
    if(!entry||!item||isCapsuleItem(item))return;
    marketDialog={type:'announce',containerId,index:Number(index),quantity:1,price:100,currency:'zeni'};
    render();
  }
  function marketPromptPPListing(){
    const available=Math.floor(Math.max(0,Number(state.profile.premiumPoints??state.profile.vipCredits??0))/10)*10;
    if(available<10){marketMessage='Você precisa ter pelo menos 10 Premium Points para anunciar.';render();return;}
    marketDialog={type:'announce-pp',itemId:'premium_points_trade',quantity:10,price:100,currency:'zeni'};
    render();
  }

  function renderMarketDialog(){
    const dialog=marketDialog;
    if(!dialog)return '';
    if(dialog.type==='announce-pp'){
      const item=itemCatalog.premium_points_trade;
      const available=Math.floor(Math.max(0,Number(state.profile.premiumPoints??state.profile.vipCredits??0))/10)*10;
      const quantity=Math.max(10,Math.min(available,Math.floor(Number(dialog.quantity||10)/10)*10));
      const price=Math.max(1,Number(dialog.price||100));
      const fee=0;
      return `<div class="market-dialog-backdrop"><section class="market-dialog"><button class="market-dialog-close" data-market-dialog-close>×</button><h2>Anunciar Premium Points</h2><div class="market-dialog-item">${marketItemCard(item.id,'common')}<div><strong>Premium Points</strong><small>Disponível: ${available.toLocaleString('pt-BR')} PP · venda em lotes de 10</small></div></div><label>Quantidade de PP<input data-market-dialog-quantity type="number" min="10" max="${available}" step="10" value="${quantity}"></label><label>Preço por 1 PP em Zeni<input data-market-dialog-price type="number" min="1" value="${price}"></label><div class="market-dialog-summary"><span>Valor total: ${(price*quantity).toLocaleString('pt-BR')} Zeni · Taxa de PP: 0%</span><b>${fee.toLocaleString('pt-BR')} Zeni</b><small>Premium Points não pagam taxa no Mercado. O comprador negocia somente em múltiplos de 10 e o preço informado é por 1 PP.</small></div><button class="market-dialog-primary" data-market-dialog-confirm-announce>Anunciar PP</button></section></div>`;
    }
    if(dialog.type==='announce'){
      const entry=state.containers?.[dialog.containerId]?.items?.[Number(dialog.index)];
      const item=itemCatalog[entry?.itemId];
      if(!entry||!item)return '';
      const max=Math.max(1,Number(entry.quantity||1));
      const quantity=Math.max(1,Math.min(max,Number(dialog.quantity||1)));
      const price=Math.max(1,Number(dialog.price||100));
      const fee=Math.max(1,Math.ceil(price*quantity*0.02));
      return `<div class="market-dialog-backdrop"><section class="market-dialog">
        <button class="market-dialog-close" data-market-dialog-close>×</button>
        <h2>Anunciar no Mercado</h2>
        <div class="market-dialog-item">${marketItemCard(item.id,entry.rarity||item.rarity||'common')}<div><strong>${escapeHtml(item.name)}</strong><small>Disponível: ${max}x</small></div></div>
        <label>Quantidade<input data-market-dialog-quantity type="number" min="1" max="${max}" value="${quantity}"></label>
        <label>Preço por unidade<input data-market-dialog-price type="number" min="1" value="${price}"></label>
        <label>Moeda<select data-market-dialog-currency>
          <option value="zeni" ${dialog.currency==='zeni'?'selected':''}>Zeni</option>
          <option value="premium" ${dialog.currency==='premium'?'selected':''}>Premium Points</option>
        </select></label>
        <div class="market-dialog-summary"><span>Taxa de 2%</span><b>${fee.toLocaleString('pt-BR')} ${dialog.currency==='premium'?'PP':'Zeni'}</b><small>O anúncio dura 7 dias. Cancelar antes do prazo perde a taxa.</small></div>
        <button class="market-dialog-primary" data-market-dialog-confirm-announce>Anunciar</button>
      </section></div>`;
    }
    const title=dialog.title||'Confirmar operação';
    return `<div class="market-dialog-backdrop"><section class="market-dialog confirm">
      <button class="market-dialog-close" data-market-dialog-close>×</button>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(dialog.message||'Deseja continuar?')}</p>
      ${dialog.type==='vip-buy'?`<p class="market-dialog-message">${escapeHtml(dialog.message||'')}</p>`:''}
      ${dialog.type==='sell-request'?`<label>Quantidade<input data-market-dialog-sell-quantity type="number" min="${dialog.ppAsset?10:1}" step="${dialog.ppAsset?10:1}" max="${dialog.maxQuantity}" value="${dialog.quantity||dialog.maxQuantity}"></label>`:''}
      <div class="market-dialog-actions"><button data-market-dialog-close>Cancelar</button><button class="market-dialog-primary" data-market-dialog-confirm>Confirmar</button></div>
    </section></div>`;
  }

  async function marketMutate(path,payload){marketLoading=true;marketMessage='';render();try{const result=await marketApi(path,{method:'POST',body:JSON.stringify(payload)});marketMessage=result.message||'Operação concluída.';if(result.state)applyAuthoritativeState(result.state);marketLoading=false;await loadMarketData();}catch(error){marketMessage=error.message;marketLoading=false;render();}}
  function marketFindSellableForRequest(request){if(request?.item_id==='premium_points_trade'){const available=Math.floor(Math.max(0,Number(state.profile.premiumPoints??state.profile.vipCredits??0))/10)*10;return available>=10?{virtualMarketAsset:true,available,item:itemCatalog.premium_points_trade,rarity:'common'}:null;}return marketInventoryEntries().find(x=>!x.entry.locked&&x.item.id===request.item_id&&x.rarity===request.rarity)}
  function bindMarketEvents(){
    if(!marketOpen)return;
    root.querySelectorAll('[data-market-tab]').forEach(b=>b.addEventListener('click',()=>{marketTab=b.dataset.marketTab;marketDialog=null;render()}));
    root.querySelectorAll('[data-market-category]').forEach(b=>b.addEventListener('click',()=>{marketCategory=b.dataset.marketCategory;render()}));
    root.querySelector('[data-market-search]')?.addEventListener('input',e=>{marketSearch=e.target.value;render()});
    root.querySelector('[data-market-sort]')?.addEventListener('change',e=>{marketSort=e.target.value;render()});
    root.querySelector('[data-market-rarity]')?.addEventListener('change',e=>{marketRarity=e.target.value;render()});
    root.querySelector('[data-market-announce-rarity]')?.addEventListener('change',e=>{marketAnnounceRarity=e.target.value;render()});
    root.querySelector('[data-market-history-filter]')?.addEventListener('change',e=>{marketHistoryFilter=e.target.value;render()});
    root.querySelectorAll('[data-market-buy]').forEach(b=>b.addEventListener('click',()=>{
      const listing=(marketData?.listings||[]).find(row=>row.id===b.dataset.marketBuy);
      const item=itemCatalog[listing?.item_id];
      marketDialog={type:'buy',title:'Confirmar compra',message:`Comprar ${Number(listing?.quantity||1)}x ${item?.name||'item'} por ${marketPrice(Number(listing?.price||0)*Number(listing?.quantity||1),listing?.currency)}?`,listingId:b.dataset.marketBuy};
      render();
    }));
    root.querySelectorAll('[data-market-cancel-listing]').forEach(b=>b.addEventListener('click',()=>{
      marketDialog={type:'cancel-listing',title:'Cancelar anúncio',message:'O item será devolvido, mas a taxa de 2% será perdida.',listingId:b.dataset.marketCancelListing};
      render();
    }));
    root.querySelectorAll('[data-market-open-announce]').forEach(b=>b.addEventListener('click',()=>{const [c,i]=b.dataset.marketOpenAnnounce.split('|');marketPromptListing(c,Number(i))}));
    root.querySelector('[data-market-open-pp-announce]')?.addEventListener('click',marketPromptPPListing);
    root.querySelectorAll('[data-market-lock]').forEach(b=>b.addEventListener('click',()=>{const [containerId,index,itemId,instanceId]=b.dataset.marketLock.split('|');socket.sendGameAction('toggle-item-lock',{containerId,index:Number(index),itemId,instanceId:instanceId||null});setTimeout(()=>{if(marketOpen){marketData=null;render()}},250)}));
    root.querySelector('[data-market-request-item]')?.addEventListener('change',e=>{const pp=e.target.value==='premium_points_trade';const q=root.querySelector('[data-market-request-quantity]'),currency=root.querySelector('[data-market-request-currency]'),rarity=root.querySelector('[data-market-request-rarity]');if(q){q.min=pp?'10':'1';q.step=pp?'10':'1';q.value=pp?'10':'1';}if(currency){if(pp)currency.value='zeni';currency.disabled=pp;}if(rarity){if(pp)rarity.value='common';rarity.disabled=pp;}});
    root.querySelector('[data-market-request-form]')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const itemId=String(f.get('itemId')||'');let quantity=Number(f.get('quantity'));let currency=String(f.get('currency')||'zeni'),rarity=String(f.get('rarity')||'common');if(itemId==='premium_points_trade'){if(quantity<10||quantity%10!==0){marketMessage='Premium Points só podem ser solicitados em múltiplos de 10.';render();return;}currency='zeni';rarity='common';}marketMutate('/api/market/requests',{characterId:state.profile.id,itemId,rarity,quantity,price:Number(f.get('price')),currency})});
    root.querySelectorAll('[data-market-cancel-request]').forEach(b=>b.addEventListener('click',()=>{
      marketDialog={type:'cancel-request',title:'Cancelar solicitação',message:'A custódia reservada será devolvida ao personagem.',requestId:b.dataset.marketCancelRequest};
      render();
    }));
    root.querySelectorAll('[data-market-sell-request]').forEach(b=>b.addEventListener('click',()=>{
      const req=(marketData?.requests||[]).find(r=>r.id===b.dataset.marketSellRequest);
      const found=marketFindSellableForRequest(req);
      if(!found){marketMessage=req?.item_id==='premium_points_trade'?'Você precisa ter pelo menos 10 Premium Points para atender esta solicitação.':'Você não possui esse item e raridade desbloqueado na Backpack/Depot.';render();return}
      const ppAsset=req.item_id==='premium_points_trade';
      const rawQty=ppAsset?Math.min(Number(found.available||0),Number(req.remaining_quantity||0)):Math.min(Number(found.entry.quantity||1),Number(req.remaining_quantity||1));
      const qty=ppAsset?Math.floor(rawQty/10)*10:rawQty;
      if(ppAsset&&qty<10){marketMessage='A quantidade restante não forma um lote de 10 PP.';render();return}
      marketDialog={type:'sell-request',title:'Vender para solicitação',message:`Venda instantânea por ${marketPrice(req.unit_price,req.currency)}/un. A taxa de 2% será descontada do valor recebido.${ppAsset?' Premium Points são transferidos diretamente do saldo da conta.':''}`,requestId:req.id,containerId:found.containerId,index:found.index,maxQuantity:qty,quantity:qty,ppAsset};
      render();
    }));
  }

  function bindMarketDialogEvents(){
    if(!marketDialog)return;
    root.querySelectorAll('[data-market-dialog-close]').forEach(b=>b.addEventListener('click',()=>{marketDialog=null;render()}));
    root.querySelector('[data-market-dialog-quantity]')?.addEventListener('input',e=>{marketDialog.quantity=Number(e.target.value)||1;});
    root.querySelector('[data-market-dialog-price]')?.addEventListener('input',e=>{marketDialog.price=Number(e.target.value)||1;});
    root.querySelector('[data-market-dialog-currency]')?.addEventListener('change',e=>{marketDialog.currency=e.target.value;render();});
    root.querySelector('[data-market-dialog-confirm-announce]')?.addEventListener('click',()=>{
      const ppAsset=marketDialog.type==='announce-pp';
      const entry=ppAsset?null:state.containers?.[marketDialog.containerId]?.items?.[Number(marketDialog.index)];
      const max=ppAsset?Math.floor(Math.max(0,Number(state.profile.premiumPoints??state.profile.vipCredits??0))/10)*10:Math.max(1,Number(entry?.quantity||1));
      let quantity=Math.max(ppAsset?10:1,Math.min(max,Math.floor(Number(root.querySelector('[data-market-dialog-quantity]')?.value||marketDialog.quantity||1))));
      if(ppAsset)quantity=Math.floor(quantity/10)*10;
      if(ppAsset&&quantity<10){marketMessage='Premium Points só podem ser anunciados em múltiplos de 10.';marketDialog=null;render();return;}
      const price=Math.max(1,Math.floor(Number(root.querySelector('[data-market-dialog-price]')?.value||marketDialog.price||1)));
      const currency=ppAsset?'zeni':(root.querySelector('[data-market-dialog-currency]')?.value||marketDialog.currency||'zeni');
      const payload=ppAsset?{characterId:state.profile.id,itemId:'premium_points_trade',quantity,price,currency}:{characterId:state.profile.id,containerId:marketDialog.containerId,index:marketDialog.index,quantity,price,currency};
      marketDialog=null;marketMutate('/api/market/listings',payload);
    });
    root.querySelector('[data-market-dialog-confirm]')?.addEventListener('click',()=>{
      const d=marketDialog;
      marketDialog=null;
      if(d.type==='vip-buy')return vipMutate('/api/vip/purchase',{characterId:state.profile.id,productId:d.productId,newName:d.newName||''});
      if(d.type==='buy')return marketMutate(`/api/market/listings/${d.listingId}/buy`,{characterId:state.profile.id});
      if(d.type==='cancel-listing')return marketMutate(`/api/market/listings/${d.listingId}/cancel`,{characterId:state.profile.id});
      if(d.type==='cancel-request')return marketMutate(`/api/market/requests/${d.requestId}/cancel`,{characterId:state.profile.id});
      if(d.type==='sell-request'){
        let qty=Math.max(d.ppAsset?10:1,Math.min(d.maxQuantity,Math.floor(Number(root.querySelector('[data-market-dialog-sell-quantity]')?.value||d.quantity||1))));
        if(d.ppAsset)qty=Math.floor(qty/10)*10;
        return marketMutate(`/api/market/requests/${d.requestId}/sell`,{characterId:state.profile.id,containerId:d.containerId,index:d.index,quantity:qty,itemId:d.ppAsset?'premium_points_trade':undefined});
      }
    });
  }

  function vipTimeLabel(ts){const ms=Number(ts||0)-Date.now();if(ms<=0)return 'Inativo';const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000);return `${d}d ${h}h restantes`;}
  function vipProductMedia(product){
    if (product.kind==='item' && product.image) return `<img class="vip-product-sprite vip-item-art" src="${product.image}" alt="${escapeHtml(product.name)}">`;
    if (product.image) return `<img class="vip-product-art" src="${product.image}" alt="${escapeHtml(product.name)}">`;
    if (product.kind==='vocation') {
      const character = characters[product.vocationId];
      // V21.26.4: Kyabe's WoDBO base frame is much narrower than the other
      // vocation thumbnails. Use a store-specific 72x72 portrait so it has
      // the same visual weight without changing the in-game outfit sprite.
      const sprite = product.vocationId==='kyabe'
        ? './assets/generated/wodbo-vocations/store-portraits/kyabe.png?v=22.4.4'
        : (character?.sprite || './assets/generated/outfits/goku.png');
      return `<img class="vip-product-sprite${product.vocationId==='kyabe'?' vip-kyabe-store-portrait':''}" src="${sprite}" alt="${escapeHtml(product.name)}">`;
    }
    return product.kind==='vip'?'👑':(product.kind==='xp'||product.kind==='xp_boost')?'EXP':(product.kind==='loot'||product.kind==='loot_boost')?'LOOT':product.kind==='supplies'?'🎒':'✦';
  }
  function vipTabIcon(id, fallback){
    if (id==='premium') return '<img src="./assets/ui/v2130/vip-card.png" alt="">';
    if (id==='boosts') return '<img src="./assets/ui/v2130/boost-xp.png" alt="">';
    if (id==='supplies') return '<img src="./assets/ui/v2130/supplies.png" alt="">';
    if (id==='services') return '<img src="./assets/ui/v2130/nick-card.png" alt="">';
    if (id==='vocations') return '<span>🥋</span>';
    return `<span>${fallback}</span>`;
  }
  function vipProductCategory(product){
    if(product.kind==='vip')return 'premium';
    if(['xp','loot','xp_boost','loot_boost'].includes(product.kind))return 'boosts';
    if(product.kind==='supplies')return 'supplies';
    if(product.kind==='vocation')return 'vocations';
    return 'services';
  }
  function renderVip() {
    const pp=Number(state.profile.premiumPoints??state.profile.vipCredits??0),active=Number(state.profile.vipUntil||0)>Date.now();
    const unlocked=new Set(state.profile.unlockedVocations||[]);const supplyRemaining=Math.max(0,7*86400000-(Date.now()-Number(state.profile.supplyLastBoughtAt||0)));
    const tabs=[['premium','♛','Premium Time'],['boosts','⚡','Boosts'],['supplies','🎒','Suprimentos'],['services','🛠','Serviços'],['vocations','🥋','Vocações VIP']];
    const products=vipProducts.filter(p=>vipProductCategory(p)===vipStoreTab);
    return `<div class="vip-store-shell">
      <header class="vip-store-header"><div><img src="./assets/ui/v2130/vip.png" alt=""><div><h1>STORE</h1><p>Conteúdo premium do Forgotten Lands</p></div></div><div class="vip-wallet"><b>${ppIconHtml('inline')} ${pp.toLocaleString('pt-BR')} PP</b><button data-buy-premium-points>Adicionar PP</button><button class="vip-close" data-action="close-vip">×</button></div></header>
      <div class="vip-store-layout"><nav class="vip-category-tabs">${tabs.map(([id,icon,label])=>`<button data-vip-tab="${id}" class="${vipStoreTab===id?'active':''}">${vipTabIcon(id,icon)}<b>${label}</b></button>`).join('')}</nav>
      <main class="vip-store-content"><section class="vip-store-banner"><div><small>STATUS DA CONTA</small><h2>${active?'CONTA VIP ATIVA':'ELEVE SUA CONTA'}</h2><p>${active?vipTimeLabel(state.profile.vipUntil):'Ative VIP para liberar conteúdo exclusivo, depots e bônus.'}</p></div><div class="vip-status-pills"><span class="${active?'active':''}">VIP ${vipTimeLabel(state.profile.vipUntil)}</span><span>XP ${vipTimeLabel(state.profile.xpBoostUntil)}</span><span>Loot ${vipTimeLabel(state.profile.lootBoostUntil)}</span></div></section>
      <div class="vip-products modern">${products.map(p=>{const owned=p.kind==='gamepass'&&state.profile.gamePass||p.kind==='vocation'&&unlocked.has(p.vocationId);const cooldown=p.id==='supplies'&&supplyRemaining>0;return `<article class="vip-product-card kind-${p.kind}"><div class="vip-product-icon kind-${p.kind}">${vipProductMedia(p)}</div><div><strong>${p.name}</strong>${p.badge?`<em>${p.badge}</em>`:''}<ul>${p.benefits.map(b=>`<li>${b}</li>`).join('')}</ul></div><footer><b>${ppIconHtml('inline')} ${p.price}</b><button data-vip-product="${p.id}" ${owned||cooldown?'disabled':''}>${owned?'Adquirido':cooldown?`Em ${Math.ceil(supplyRemaining/86400000)}d`:'Comprar'}</button></footer></article>`}).join('')||'<div class="market-empty">Nenhum produto nesta categoria.</div>'}</div></main></div>
    </div>`;
  }
  async function vipMutate(path,payload){try{const result=await marketApi(path,{method:'POST',body:JSON.stringify(payload)});if(result.state)applyAuthoritativeState(result.state);marketMessage=result.message||'Operação concluída.';render();}catch(error){marketMessage=error.message;render();}}
  function bindVipEvents(){
    root.querySelector('[data-action="close-vip"]')?.addEventListener('click',()=>{vipStoreOpen=false;render();});
    root.querySelectorAll('[data-vip-tab]').forEach(b=>b.addEventListener('click',()=>{vipStoreTab=b.dataset.vipTab;render();}));
    root.querySelector('[data-buy-premium-points]')?.addEventListener('click',()=>{premiumPurchaseOpen=true;premiumPurchase={step:'select',brl:10,result:null,error:'',loading:false,history:[],historyLoading:false};render();});
    root.querySelectorAll('[data-vip-product]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.vipProduct;const product=vipProducts.find(p=>p.id===id);if(!product)return;let newName='';if(product.kind==='rename'){newName=window.prompt('Novo nickname:','')||'';if(!newName)return;}marketDialog={type:'vip-buy',productId:id,newName,title:'Confirmar compra',message:`Comprar ${product.name} por ${product.price} Premium Points?`,confirmLabel:'Comprar'};render();}));
  }


  function ppStatusInfo(status){
    const map={approved:['✓','Pagamento aprovado','approved'],pending:['⌛','Aguardando pagamento','pending'],rejected:['×','Pagamento recusado','rejected'],cancelled:['×','Pagamento cancelado','cancelled'],expired:['⌛','Pagamento expirado','expired'],reversed:['↩','Pagamento revertido','reversed']};
    return map[String(status||'pending').toLowerCase()]||map.pending;
  }
  function ppStatusDetailMessage(detail=''){
    const d=String(detail||'').toLowerCase();
    const messages={
      cc_rejected_high_risk:'O Mercado Pago recusou esta tentativa pela análise automática de segurança. Isso não significa que seus dados estejam incorretos. Aguarde alguns minutos antes de tentar novamente ou utilize outro meio de pagamento.',
      cc_rejected_blacklist:'O pagamento foi recusado pela análise de segurança do Mercado Pago. Utilize outro meio de pagamento.',
      cc_rejected_insufficient_amount:'O cartão não possui saldo ou limite suficiente para concluir esta compra.',
      cc_rejected_card_disabled:'O cartão está desabilitado ou bloqueado para esta compra. Verifique com o emissor ou utilize outro cartão.',
      cc_rejected_call_for_authorize:'O emissor do cartão exige autorização. Entre em contato com o emissor e tente novamente depois.',
      cc_rejected_bad_filled_card_number:'Confira o número do cartão e tente novamente.',
      cc_rejected_bad_filled_date:'Confira a data de validade do cartão e tente novamente.',
      cc_rejected_bad_filled_security_code:'Confira o código de segurança do cartão e tente novamente.',
      cc_rejected_duplicated_payment:'Uma tentativa muito parecida foi identificada recentemente. Aguarde alguns minutos antes de tentar novamente.',
      cc_rejected_max_attempts:'O limite de tentativas deste cartão foi atingido. Aguarde antes de tentar novamente ou utilize outro meio de pagamento.'
    };
    return messages[d]||'';
  }
  function ppPaymentMethodLabel(method){return String(method||'').toLowerCase()==='pix'?'PIX':'Cartão de crédito';}
  function renderPremiumHistory(){
    if(premiumPurchase.historyLoading)return '<div class="pp-history-empty">Carregando histórico...</div>';
    const rows=Array.isArray(premiumPurchase.history)?premiumPurchase.history:[];
    if(!rows.length)return '<div class="pp-history-empty">Nenhuma compra de Premium Points registrada.</div>';
    return `<div class="pp-history-list">${rows.map(row=>{const st=ppStatusInfo(row.ui_status||row.status);const when=new Date(row.created_at).toLocaleString('pt-BR');return `<article class="${st[2]}"><span class="pp-history-status">${st[0]}</span><div><b>${Number(row.premium_points||0).toLocaleString('pt-BR')} PP</b><small>${ppPaymentMethodLabel(row.payment_method)} · ${when}</small></div><div><strong>R$ ${Number(row.amount_brl||0).toFixed(2).replace('.',',')}</strong><small>${st[1]}</small></div></article>`}).join('')}</div>`;
  }
  function renderPremiumPurchase(){
    const amountBrl=normalizeDonationAmount(premiumPurchase.brl||DONATION_MIN_BRL);premiumPurchase.brl=amountBrl;
    const quote=donationQuote(amountBrl);
    let body='';
    if(premiumPurchase.step==='history'){
      body=`<div class="pp-history-head"><h3>Histórico de compras</h3><button class="pp-secondary compact" data-pp-history-refresh>Atualizar</button></div>${renderPremiumHistory()}<button class="pp-secondary" data-pp-back-select>Voltar para comprar PP</button>`;
    }else if(premiumPurchase.result){
      const r=premiumPurchase.result;const status=(r.credited?'approved':String(r.status||'pending').toLowerCase());const st=ppStatusInfo(status);const approved=status==='approved';const pending=status==='pending';
      const resultBase=Number(r.basePp??quote.basePp);const resultBonus=Number(r.bonusPp??Math.max(0,Number(r.ppAmount||0)-resultBase));const resultTotal=Number(r.ppAmount??(resultBase+resultBonus));const resultBonusPct=Number(r.bonusPercent??0);
      body=`<div class="pp-pay-result ${st[2]}"><div class="pp-pay-status-icon">${st[0]}</div><h3>${st[1]}</h3><p>${approved?`+${resultTotal.toLocaleString('pt-BR')} Premium Points foram creditados na sua conta.`:pending?`Pagamento de R$ ${Number(r.amount??amountBrl).toFixed(2).replace('.',',')} criado no Mercado Pago. Aguarde a confirmação.`:`A compra de Premium Points não foi concluída.`}</p>${resultBonus>0?`<div class="pp-bonus-result"><span>Compra: ${resultBase.toLocaleString('pt-BR')} PP</span><strong>+${resultBonus.toLocaleString('pt-BR')} PP de bônus (${resultBonusPct}%)</strong></div>`:''}${approved?`<div class="pp-balance-final">Saldo atual: <b>${Number(r.premiumPoints??state.profile.premiumPoints??0).toLocaleString('pt-BR')} PP</b></div>`:''}${!approved&&!pending&&ppStatusDetailMessage(r.statusDetail)?`<div class="pp-rejection-detail">${escapeHtml(ppStatusDetailMessage(r.statusDetail))}</div>`:''}${pending&&r.qrCodeBase64?`<img class="pp-pix-qr" src="data:image/png;base64,${r.qrCodeBase64}" alt="QR Code PIX">`:''}${pending&&r.qrCode?`<label>PIX copia e cola</label><textarea readonly data-pix-code>${r.qrCode}</textarea><button class="pp-copy" data-copy-pix>Copiar código PIX</button>`:''}<small>Status: ${escapeHtml(status)}</small>${approved?'<button class="pp-primary" data-pp-done>Concluir</button>':!pending?'<button class="pp-secondary" data-pp-new>Tentar nova compra</button>':''}</div>`;
    }else if(premiumPurchase.step==='payment'){
      body=`<div class="pp-checkout-summary"><span>R$ ${amountBrl.toFixed(2).replace('.',',')}</span><b>${quote.totalPp.toLocaleString('pt-BR')} PP${quote.bonusPp?` <small>(+${quote.bonusPp.toLocaleString('pt-BR')} bônus)</small>`:''}</b></div><div id="paymentBrick_container" class="pp-brick-container"><div class="pp-brick-loading">Carregando PIX e cartão...</div></div>${premiumPurchase.loading?'<div class="pp-processing">Processando pagamento. Não feche nem clique novamente...</div>':''}${premiumPurchase.error?`<div class="pp-payment-error">${escapeHtml(premiumPurchase.error)}</div>`:''}<button class="pp-secondary" data-pp-back ${premiumPurchase.loading?'disabled':''}>Voltar e alterar valor</button>`;
    }else{
      body=`<div class="pp-fixed-rate"><strong>R$ 1,00 = 10 PP</strong><span>O preço é fixo. Quanto maior a doação, maior o bônus de Premium Points.</span></div><div class="pp-bonus-grid"><div class="${amountBrl>=100&&amountBrl<200?'active':''}"><b>R$ 100+</b><span>+5% PP</span></div><div class="${amountBrl>=200&&amountBrl<400?'active':''}"><b>R$ 200+</b><span>+10% PP</span></div><div class="${amountBrl>=400&&amountBrl<1000?'active':''}"><b>R$ 400+</b><span>+15% PP</span></div><div class="${amountBrl>=1000?'active':''}"><b>R$ 1.000+</b><span>+25% PP</span></div></div><div class="pp-quantity"><button data-pp-minus>−</button><label class="pp-direct-entry pp-brl-entry"><span>R$</span><input type="number" min="10" step="1" inputmode="numeric" value="${amountBrl}" data-pp-input aria-label="Valor da doação em reais"></label><button data-pp-plus>+</button></div><small class="pp-round-hint" data-pp-rounded>Valor mínimo R$ 10,00 · somente valores inteiros.</small><div class="pp-shortcuts">${[10,50,100,200,400,1000].map(v=>`<button data-pp-value="${v}">R$ ${v.toLocaleString('pt-BR')}</button>`).join('')}</div><div class="pp-price-summary"><div><span>Valor da doação</span><b data-pp-summary-brl>R$ ${amountBrl.toFixed(2).replace('.',',')}</b></div><div><span>PP da compra</span><b data-pp-summary-base>${quote.basePp.toLocaleString('pt-BR')} PP</b></div><div class="pp-bonus-line ${quote.bonusPp?'active':''}"><span>Bônus${quote.bonusPercent?` (${quote.bonusPercent}%)`:''}</span><b data-pp-summary-bonus>+${quote.bonusPp.toLocaleString('pt-BR')} PP</b></div><div class="total"><span>Total a receber</span><b data-pp-summary-total>${quote.totalPp.toLocaleString('pt-BR')} PP</b></div></div><button class="pp-primary" data-pp-continue>Continuar para PIX ou cartão</button><button class="pp-secondary" data-pp-history>Histórico de compras</button>`;
    }
    return `<div class="ui-overlay-backdrop compact-overlay pp-purchase-overlay"><section class="pp-purchase-window"><header><div>${ppIconHtml()}<div><h2>COMPRAR PREMIUM POINTS</h2><p>Pagamento seguro processado pelo Mercado Pago.</p></div></div><button data-pp-close>×</button></header>${body}<footer>R$ 1,00 = 10 PP · doação mínima R$ 10,00 · valores inteiros de R$ 1,00 em R$ 1,00.</footer></section></div>`;
  }
  async function loadPremiumPaymentHistory(){premiumPurchase.historyLoading=true;render();try{const r=await marketApi('/api/payments/history');premiumPurchase.history=Array.isArray(r.payments)?r.payments:[];}catch(e){premiumPurchase.error=e.message||'Falha ao carregar histórico.';}finally{premiumPurchase.historyLoading=false;render();}}

  function stopPremiumPaymentPoll(){if(premiumPaymentPoll){clearInterval(premiumPaymentPoll);premiumPaymentPoll=null;}}
  async function loadMercadoPagoSdk(){if(window.MercadoPago)return;if(!document.querySelector('script[data-mercadopago-sdk]')){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://sdk.mercadopago.com/js/v2';s.dataset.mercadopagoSdk='1';s.onload=resolve;s.onerror=()=>reject(new Error('Não foi possível carregar o SDK do Mercado Pago.'));document.head.appendChild(s);});}else{for(let i=0;i<100&&!window.MercadoPago;i++)await new Promise(r=>setTimeout(r,50));}if(!window.MercadoPago)throw new Error('SDK do Mercado Pago indisponível.');}
  function currentMercadoPagoDeviceInfo(){
    const candidates=[
      ['cache',mercadoPagoDeviceIdCache],
      ['MP_DEVICE_SESSION_ID',window.MP_DEVICE_SESSION_ID],
      ['deviceId_global',window.deviceId],
      ['dboMercadoPagoDeviceId',window.dboMercadoPagoDeviceId],
      ['deviceId_input',document.getElementById('deviceId')?.value]
    ];
    for(const [source,value] of candidates){
      const normalized=String(value||'').trim();
      if(normalized.length>=8&&normalized.length<=2048){
        mercadoPagoDeviceIdCache=normalized;
        return {id:normalized,source};
      }
    }
    return {id:'',source:''};
  }
  function currentMercadoPagoDeviceId(){return currentMercadoPagoDeviceInfo().id;}
  async function loadMercadoPagoSecurity({waitMs=12000}={}){
    const existing=currentMercadoPagoDeviceInfo();
    if(existing.id)return existing;

    let deviceInput=document.getElementById('deviceId');
    if(!deviceInput){
      deviceInput=document.createElement('input');
      deviceInput.type='hidden';
      deviceInput.id='deviceId';
      deviceInput.name='deviceId';
      deviceInput.setAttribute('aria-hidden','true');
      document.body.appendChild(deviceInput);
    }

    // V21.25.16: aceita Device IDs longos gerados pelo security.js e prioriza o script estatico.
    // O carregamento dinamico fica apenas como fallback para instalacoes antigas.
    let script=document.querySelector('script[src*="mercadopago.com/v2/security.js"],script[data-mercadopago-security]');
    if(!script){
      script=document.createElement('script');
      script.setAttribute('view','checkout');
      script.dataset.mercadopagoSecurity='1';
      script.src='https://www.mercadopago.com/v2/security.js';
      document.head.appendChild(script);
    }

    const deadline=Date.now()+Math.max(1000,Number(waitMs)||12000);
    while(Date.now()<deadline){
      const info=currentMercadoPagoDeviceInfo();
      if(info.id)return info;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return currentMercadoPagoDeviceInfo();
  }
  async function mountPremiumPaymentBrick(){
    if(!premiumPurchaseOpen||premiumPurchase.step!=='payment'||premiumPurchase.result)return;
    const target=root.querySelector('#paymentBrick_container');if(!target)return;
    try{await loadMercadoPagoSdk();const cfg=await marketApi('/api/payments/config');if(!cfg.enabled)throw new Error('Mercado Pago ainda não está configurado no servidor.');
      try{await window.dboPaymentBrickController?.unmount?.()}catch{};
      const mp=new window.MercadoPago(cfg.publicKey,{locale:'pt-BR'});const securityInfo=await loadMercadoPagoSecurity({waitMs:12000});console.info('[MercadoPago] Device ID:',securityInfo.id?'ready':'unavailable',securityInfo.source||'',securityInfo.id?`len=${securityInfo.id.length}`:'');const bricks=mp.bricks();const quote=donationQuote(premiumPurchase.brl);const amount=quote.amountBrl;
      window.dboPaymentBrickController=await bricks.create('payment','paymentBrick_container',{initialization:{amount},customization:{paymentMethods:{bankTransfer:'all',creditCard:'all',prepaidCard:'all',maxInstallments:1}},callbacks:{onReady:()=>{},onError:error=>{console.error('[MercadoPago Brick]',error);},onSubmit:({selectedPaymentMethod,formData},additionalData)=>new Promise(async(resolve,reject)=>{if(premiumPurchase.loading){reject(new Error('Pagamento já está sendo processado.'));return;}try{const paymentType=String(formData?.payment_type_id||formData?.paymentTypeId||selectedPaymentMethod||'').toLowerCase();const isCard=paymentType.includes('card')||Boolean(formData?.token);const deviceInfo=isCard?await loadMercadoPagoSecurity({waitMs:12000}):currentMercadoPagoDeviceInfo();const deviceSessionId=deviceInfo.id;if(isCard&&!deviceSessionId){throw new Error('Não foi possível concluir a validação de segurança do Mercado Pago. Reabra a compra e tente novamente. Se usar bloqueador de conteúdo, permita o Mercado Pago neste site.');}premiumPurchase.loading=true;premiumPurchase.error='';render();const r=await marketApi('/api/payments/mercadopago/create',{method:'POST',body:JSON.stringify({characterId:state.profile.id,ppAmount:quote.basePp,amountBrl:quote.amountBrl,paymentData:{...formData,_selectedPaymentMethod:selectedPaymentMethod,_deviceSessionId:deviceSessionId,_deviceSessionSource:deviceInfo.source,_cardholderName:String(additionalData?.cardholderName||'')}})});premiumPurchase.result=r;if(Number(r.premiumPoints)>=0){state.profile.premiumPoints=Number(r.premiumPoints);state.profile.vipCredits=Number(r.premiumPoints);}resolve();render();if(!r.credited&&r.id)startPremiumPaymentPoll(r.id);}catch(e){premiumPurchase.error=e.message||'Falha ao criar pagamento.';reject(e);render();}finally{premiumPurchase.loading=false;}})}});
    }catch(e){premiumPurchase.error=e.message||'Falha ao carregar pagamento.';render();}
  }
  function startPremiumPaymentPoll(id){stopPremiumPaymentPoll();premiumPaymentPoll=setInterval(async()=>{if(!premiumPurchaseOpen){stopPremiumPaymentPoll();return;}try{const r=await marketApi(`/api/payments/${id}`);const status=String(r.payment?.status||'pending');if(r.payment?.credited){state.profile.premiumPoints=Number(r.premiumPoints||state.profile.premiumPoints||0);state.profile.vipCredits=state.profile.premiumPoints;}premiumPurchase.result={...(premiumPurchase.result||{}),...(r.payment||{}),status,credited:Boolean(r.payment?.credited),premiumPoints:r.premiumPoints};if(['approved','rejected','cancelled','expired','reversed'].includes(status))stopPremiumPaymentPoll();render();}catch{}},5000);}
  function syncDonationAmountInput(rawValue){
    const amount=normalizeDonationAmount(rawValue);premiumPurchase.brl=amount;const quote=donationQuote(amount);
    const hint=root.querySelector('[data-pp-rounded]');const brlNode=root.querySelector('[data-pp-summary-brl]');const baseNode=root.querySelector('[data-pp-summary-base]');const bonusNode=root.querySelector('[data-pp-summary-bonus]');const totalNode=root.querySelector('[data-pp-summary-total]');
    if(hint)hint.textContent=`Valor considerado: R$ ${amount.toFixed(2).replace('.',',')} · ${quote.totalPp.toLocaleString('pt-BR')} PP no total${quote.bonusPp?` (+${quote.bonusPp.toLocaleString('pt-BR')} de bônus)`:''}.`;
    if(brlNode)brlNode.textContent=`R$ ${amount.toFixed(2).replace('.',',')}`;
    if(baseNode)baseNode.textContent=`${quote.basePp.toLocaleString('pt-BR')} PP`;
    if(bonusNode)bonusNode.textContent=`+${quote.bonusPp.toLocaleString('pt-BR')} PP`;
    if(totalNode)totalNode.textContent=`${quote.totalPp.toLocaleString('pt-BR')} PP`;
    return {amount,quote};
  }
  function bindPremiumPurchaseEvents(){
    root.querySelector('[data-pp-close]')?.addEventListener('click',async()=>{stopPremiumPaymentPoll();try{await window.dboPaymentBrickController?.unmount?.()}catch{}premiumPurchaseOpen=false;render();});
    const directInput=root.querySelector('[data-pp-input]');
    directInput?.addEventListener('input',event=>{syncDonationAmountInput(event.currentTarget.value);});
    directInput?.addEventListener('blur',event=>{const {amount}=syncDonationAmountInput(event.currentTarget.value);event.currentTarget.value=String(amount);render();});
    directInput?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();const {amount}=syncDonationAmountInput(event.currentTarget.value);event.currentTarget.value=String(amount);event.currentTarget.blur();}});
    root.querySelector('[data-pp-minus]')?.addEventListener('click',()=>{premiumPurchase.brl=Math.max(DONATION_MIN_BRL,normalizeDonationAmount(premiumPurchase.brl)-1);render();});
    root.querySelector('[data-pp-plus]')?.addEventListener('click',()=>{premiumPurchase.brl=normalizeDonationAmount(premiumPurchase.brl)+1;render();});
    root.querySelectorAll('[data-pp-value]').forEach(b=>b.addEventListener('click',()=>{premiumPurchase.brl=normalizeDonationAmount(b.dataset.ppValue);render();}));
    root.querySelector('[data-pp-continue]')?.addEventListener('click',()=>{const input=root.querySelector('[data-pp-input]');premiumPurchase.brl=normalizeDonationAmount(input?.value??premiumPurchase.brl);premiumPurchase.step='payment';premiumPurchase.error='';render();});
    root.querySelector('[data-pp-back]')?.addEventListener('click',async()=>{try{await window.dboPaymentBrickController?.unmount?.()}catch{}premiumPurchase.step='select';premiumPurchase.error='';render();});
    root.querySelector('[data-copy-pix]')?.addEventListener('click',()=>navigator.clipboard?.writeText(root.querySelector('[data-pix-code]')?.value||''));
    root.querySelector('[data-pp-done]')?.addEventListener('click',()=>{premiumPurchaseOpen=false;stopPremiumPaymentPoll();render();});
    root.querySelector('[data-pp-new]')?.addEventListener('click',()=>{premiumPurchase={step:'select',brl:premiumPurchase.brl||DONATION_MIN_BRL,result:null,error:'',loading:false,history:premiumPurchase.history||[],historyLoading:false};render();});
    root.querySelector('[data-pp-history]')?.addEventListener('click',()=>{premiumPurchase.step='history';premiumPurchase.error='';loadPremiumPaymentHistory();});
    root.querySelector('[data-pp-history-refresh]')?.addEventListener('click',loadPremiumPaymentHistory);
    root.querySelector('[data-pp-back-select]')?.addEventListener('click',()=>{premiumPurchase.step='select';render();});
    if(premiumPurchaseOpen&&premiumPurchase.step==='payment'&&!premiumPurchase.result)setTimeout(mountPremiumPaymentBrick,0);
  }

  const dailyVipDays=new Set(Object.keys(DAILY_VIP_BONUS_DAYS).map(Number));
  const FORGE_REROLL_COST = 2000000;
  const FORGE_BATCH_OPTIONS=[1,5,10,25,50,100]; // Compatibilidade de regressão: FORGE_BATCH_OPTIONS=[5,10,25,50,100]
  function forgeAllEntries(){
    const rows=[];
    for(const container of inventoryContainers(state))for(const [index,entry] of (container.items||[]).entries()){
      const item=itemCatalog[entry.itemId];if(!item||!entry.instanceId||entry.locked||!isRarityEligibleItem(item))continue;
      rows.push({kind:'container',containerId:container.id,index,entry,item,meta:entry});
    }
    for(const [slot,itemId] of Object.entries(state.equipment||{})){
      if(slot==='backpack'||!itemId)continue;const item=itemCatalog[itemId],meta=state.equipmentMeta?.[slot];
      if(!item||!meta?.instanceId||!isRarityEligibleItem(item))continue;
      rows.push({kind:'equipment',slot,item,entry:null,meta});
    }
    return rows.sort((a,b)=>String(a.item.name).localeCompare(String(b.item.name),'pt-BR'));
  }
  function forgeEntryByInstance(instanceId){return forgeAllEntries().find(row=>String(row.meta?.instanceId||'')===String(instanceId||''))||null;}
  function applyLocalForgeRarity(instanceId,rarity){
    const row=forgeEntryByInstance(instanceId);if(!row)return false;const def=rarityDefinition(rarity);
    if(row.kind==='container')Object.assign(row.entry,{rarity:def.id,rarityTier:def.tier,rarityMultiplier:def.multiplier,source:'forge'});
    else state.equipmentMeta[row.slot]={...(row.meta||{}),rarity:def.id,rarityTier:def.tier,rarityMultiplier:def.multiplier,source:'forge'};
    return true;
  }
  function forgeComparison(oldRarity,newRarity){const oldDef=rarityDefinition(oldRarity),newDef=rarityDefinition(newRarity);return newDef.tier>oldDef.tier?'better':newDef.tier<oldDef.tier?'worse':'equal';}
  function ensureLocalForgeLedger(){state.forge ||= {pending:null,lastResult:null,history:[],totalSpent:0};state.forge.history=Array.isArray(state.forge.history)?state.forge.history:[];state.forge.totalSpent=Math.max(0,Number(state.forge.totalSpent||0));}
  function localForgeCharge(){ensureLocalForgeLedger();if(Number(state.profile.bank||0)<FORGE_REROLL_COST)return false;state.profile.bank-=FORGE_REROLL_COST;state.forge.totalSpent+=FORGE_REROLL_COST;return true;}
  function localForgeHistory(data={}){ensureLocalForgeLedger();state.forge.history.push({...data,createdAt:Date.now()});state.forge.history=state.forge.history.slice(-50);}
  function localForgeRoll(instanceId,attempts=forgeAttempts){
    ensureLocalForgeLedger();if(state.forge.pending){log('Aceite, mantenha ou continue o resultado atual da Forja.');return;}
    const row=forgeEntryByInstance(instanceId);if(!row)return;
    attempts=FORGE_BATCH_OPTIONS.includes(Number(attempts))?Number(attempts):1;
    const old=rarityDefinition(row.meta?.rarity);if(Number(state.profile.bank||0)<FORGE_REROLL_COST){log('Você precisa de 2.000.000 Zeni para iniciar a Forja.');return;}
    let used=0,last=old,best=null;
    while(used<attempts&&localForgeCharge()){
      const next=rollItemRarity();used+=1;last=next;if(!best||next.tier>best.tier)best=next;
      if(attempts===1||next.tier>old.tier){
        const comparison=forgeComparison(old.id,next.id);
        state.forge.pending={offerId:`local-${Date.now()}`,instanceId:String(instanceId),itemId:row.item.id,itemName:row.item.name,oldRarity:old.id,newRarity:next.id,cost:FORGE_REROLL_COST*used,createdAt:Date.now(),attemptsRequested:attempts,attemptsUsed:used,attemptsRemaining:Math.max(0,attempts-used),comparison};
        state.forge.lastResult={instanceId:String(instanceId),oldRarity:old.id,newRarity:next.id,comparison,attemptsRequested:attempts,attemptsUsed:used,createdAt:Date.now()};persist();render();return;
      }
    }
    const observed=best||last||old;const comparison=forgeComparison(old.id,observed.id);state.forge.lastResult={instanceId:String(instanceId),oldRarity:old.id,newRarity:observed.id,comparison,attemptsRequested:attempts,attemptsUsed:used,noImprovement:true,createdAt:Date.now()};localForgeHistory({itemId:row.item.id,itemName:row.item.name,oldRarity:old.id,newRarity:observed.id,comparison,attemptsRequested:attempts,attemptsUsed:used,cost:FORGE_REROLL_COST*used,accepted:false,noImprovement:true});persist();log(`Forja: ${used}/${attempts} tentativas sem melhoria.`);render();
  }
  function localForgeContinue(){
    const p=state.forge?.pending;if(!p)return;let remaining=Math.max(0,Number(p.attemptsRemaining||0));if(!remaining)return;
    const benchmark=rarityDefinition(p.newRarity),old=rarityDefinition(p.oldRarity);let used=0;
    while(used<remaining&&localForgeCharge()){
      const next=rollItemRarity();used+=1;
      if(next.tier>benchmark.tier){p.newRarity=next.id;p.attemptsUsed=Number(p.attemptsUsed||0)+used;p.attemptsRemaining=Math.max(0,remaining-used);p.cost=Number(p.cost||0)+FORGE_REROLL_COST*used;p.comparison=forgeComparison(old.id,next.id);p.createdAt=Date.now();state.forge.lastResult={instanceId:p.instanceId,oldRarity:old.id,newRarity:next.id,comparison:p.comparison,attemptsRequested:p.attemptsRequested,attemptsUsed:p.attemptsUsed,createdAt:Date.now()};persist();render();return;}
    }
    p.attemptsUsed=Number(p.attemptsUsed||0)+used;p.attemptsRemaining=Math.max(0,remaining-used);p.cost=Number(p.cost||0)+FORGE_REROLL_COST*used;state.forge.lastResult={instanceId:p.instanceId,oldRarity:p.oldRarity,newRarity:p.newRarity,comparison:forgeComparison(p.oldRarity,p.newRarity),attemptsRequested:p.attemptsRequested,attemptsUsed:p.attemptsUsed,noFurtherImprovement:true,createdAt:Date.now()};persist();render();
  }
  function localForgeResolve(accept){const p=state.forge?.pending;if(!p)return;if(accept&&!applyLocalForgeRarity(p.instanceId,p.newRarity)){log('Item não encontrado.');return;}const comparison=forgeComparison(p.oldRarity,p.newRarity);state.forge.lastResult={instanceId:p.instanceId,oldRarity:p.oldRarity,newRarity:p.newRarity,comparison,attemptsRequested:p.attemptsRequested,attemptsUsed:p.attemptsUsed,accepted:Boolean(accept),createdAt:Date.now()};localForgeHistory({itemId:p.itemId,itemName:p.itemName,oldRarity:p.oldRarity,newRarity:p.newRarity,comparison,attemptsRequested:p.attemptsRequested,attemptsUsed:p.attemptsUsed,cost:Number(p.cost||0),accepted:Boolean(accept)});state.forge.pending=null;persist();render();}
  function forgeComparisonLabel(comparison){return comparison==='better'?'▲ MELHOR':comparison==='worse'?'▼ PIOR':'= IGUAL';}
  // MELHOR OFERTA ENCONTRADA — rótulo legado preservado para regressão da Forja.
  function renderForge(){
    ensureLocalForgeLedger();
    const entries=forgeAllEntries(),pending=state.forge?.pending||null,lastResult=state.forge?.lastResult||null;
    if(!forgeSelectedInstanceId&&entries[0])forgeSelectedInstanceId=entries[0].meta.instanceId;
    const selected=forgeEntryByInstance(pending?.instanceId||forgeSelectedInstanceId);
    const selectedAdjusted=selected?rarityAdjustedItem(selected.item,selected.meta):null;
    const oldDef=rarityDefinition(pending?.oldRarity||selected?.meta?.rarity||'common'),newDef=rarityDefinition(pending?.newRarity||oldDef.id);
    const comparison=pending?.comparison||forgeComparison(oldDef.id,newDef.id);
    const attemptsUsed=Number(pending?.attemptsUsed||0),attemptsRequested=Number(pending?.attemptsRequested||forgeAttempts),remaining=Number(pending?.attemptsRemaining||0);
    const lastOld=rarityDefinition(lastResult?.oldRarity||'common'),lastNew=rarityDefinition(lastResult?.newRarity||lastOld.id),lastComparison=lastResult?.comparison||forgeComparison(lastOld.id,lastNew.id);
    const history=[...(state.forge.history||[])].reverse().slice(0,20);
    return `<div class="ui-overlay-backdrop forge-backdrop"><section class="forge-window"><header><div><span>⚒</span><div><h2>FORJA DE RARIDADE</h2><p>Escolha 1, 5, 10, 25, 50 ou 100 tentativas. A sequência em lote para quando encontra um tier melhor.</p></div></div><button data-action="close-forge">×</button></header><div class="forge-wallet"><span>Seu saldo</span><b>${Number(state.profile.bank||0).toLocaleString('pt-BR')} Zeni</b><em>Custo por tentativa: ${FORGE_REROLL_COST.toLocaleString('pt-BR')} Zeni · total gasto na Forja: <strong>${Number(state.forge.totalSpent||0).toLocaleString('pt-BR')} Zeni</strong>.</em></div>${pending?`<div class="forge-result"><div class="forge-result-item">${selectedAdjusted?itemVisual(selectedAdjusted):''}<strong>${escapeHtml(pending.itemName||selected?.item?.name||'Item')}</strong></div><div class="forge-tier-comparison"><article class="rarity-${oldDef.id}"><small>TIER ATUAL</small><b>${oldDef.name}</b></article><span>➜</span><article class="rarity-${newDef.id}"><small>RESULTADO</small><b>${newDef.name}</b><em class="forge-comparison ${comparison}">${forgeComparisonLabel(comparison)}</em></article></div><div class="forge-batch-progress"><b>${attemptsUsed}/${attemptsRequested}</b> tentativas realizadas · <strong>${remaining}</strong> restantes</div><div class="forge-result-actions"><button data-forge-reject>Manter ${oldDef.name}</button>${remaining>0?`<button class="continue" data-forge-continue>Continuar ${remaining} tentativa(s)</button>`:''}<button class="accept" data-forge-accept>Aceitar ${newDef.name}</button></div></div>`:`<div class="forge-body"><div class="forge-items"><h3>ESCOLHA UM ITEM</h3><div class="forge-grid">${entries.length?entries.map(row=>{const adjusted=rarityAdjustedItem(row.item,row.meta),def=rarityDefinition(row.meta?.rarity);return `<button class="forge-item rarity-border-${def.id} ${String(row.meta.instanceId)===String(forgeSelectedInstanceId)?'selected':''}" data-forge-item="${escapeHtml(row.meta.instanceId)}">${itemVisual(adjusted)}<strong>${escapeHtml(row.item.name)}</strong><small>${def.name}${row.kind==='equipment'?' · Equipado':''}</small></button>`}).join(''):'<p>Nenhum equipamento elegível para a Forja.</p>'}</div></div><aside class="forge-selection">${selected?`${itemVisual(selectedAdjusted)}<h3>${escapeHtml(selected.item.name)}</h3><span>Tier atual: <b>${oldDef.name}</b></span><p>1x sempre mostra o resultado para aceitar ou manter. Em lote, a roleta pausa ao encontrar melhoria.</p><div class="forge-attempt-options">${FORGE_BATCH_OPTIONS.map(n=>`<button class="${forgeAttempts===n?'selected':''}" data-forge-attempts="${n}">${n}x</button>`).join('')}</div><small>Custo máximo do lote: ${(FORGE_REROLL_COST*forgeAttempts).toLocaleString('pt-BR')} Zeni</small><button class="forge-roll-main" data-forge-roll ${Number(state.profile.bank||0)<FORGE_REROLL_COST?'disabled':''}>Iniciar ${forgeAttempts} tentativa${forgeAttempts===1?'':'s'}</button>${lastResult?`<div class="forge-last-result ${lastComparison}"><b>${forgeComparisonLabel(lastComparison)}</b><span>${lastOld.name} → ${lastNew.name}</span><small>${Number(lastResult.attemptsUsed||0)}/${Number(lastResult.attemptsRequested||0)} tentativas${lastResult.noImprovement?' · nenhuma melhoria encontrada':''}</small></div>`:''}`:'<p>Selecione um item.</p>'}</aside></div>`}<section class="forge-history"><header><h3>Histórico</h3><b>Total gasto: ${Number(state.forge.totalSpent||0).toLocaleString('pt-BR')} Zeni</b></header>${history.length?history.map(row=>{const old=rarityDefinition(row.oldRarity),next=rarityDefinition(row.newRarity),cmp=row.comparison||forgeComparison(old.id,next.id);return `<article><span>${new Date(row.createdAt||Date.now()).toLocaleString('pt-BR')}</span><strong>${escapeHtml(row.itemName||itemCatalog[row.itemId]?.name||'Item')}</strong><em class="forge-comparison ${cmp}">${old.name} → ${next.name}</em><small>${Number(row.attemptsUsed||0)} tentativa(s) · ${Number(row.cost||0).toLocaleString('pt-BR')} Zeni · ${row.noImprovement?'sem melhoria':row.accepted===true?'aceito':row.accepted===false?'mantido':'finalizado'}</small></article>`}).join(''):'<p>Nenhuma tentativa concluída ainda.</p>'}</section></section></div>`;
  }

  function dailyRewardForDay(day){
    const d=Math.max(1,Math.min(31,Number(day)||1));
    const base=dailyLoginReward(d),vipBonus=DAILY_VIP_BONUS_DAYS[d]||null;
    return {...base,itemDef:base.item?itemCatalog[base.item]:null,vipBonus};
  }
  function dailyRewardLabel(day){
    const r=dailyRewardForDay(day),base=`${Number(r.qty||1).toLocaleString('pt-BR')}x ${r.itemDef?.name||r.item}`;
    return r.vipBonus?`VIP: 1h ${r.vipBonus.kind==='xp'?'XP':'Loot'} · Free: ${base}`:base;
  }
  function renderDailyGift(){
    const now=Date.now(),last=Number(state.profile.dailyLastClaimAt||0),claimedToday=last&&brasiliaDayKey(last)===brasiliaDayKey();
    const nowBr=new Date(now-3*3600000),lastBr=last?new Date(last-3*3600000):null;
    const sameMonth=Boolean(lastBr&&lastBr.getUTCFullYear()===nowBr.getUTCFullYear()&&lastBr.getUTCMonth()===nowBr.getUTCMonth());
    const claimedCount=sameMonth?Math.max(0,Math.min(31,Number(state.profile.dailyLoginStreak||0))):0;
    const nextReward=Math.min(31,claimedCount+1),monthComplete=claimedCount>=31;
    return `<div class="ui-overlay-backdrop compact-overlay"><section class="daily-gift-window"><header><div><span>🎁</span><div><h2>DAILY GIFT</h2><p>Sequência mensal por presença: cada login resgatado avança 1 recompensa, independentemente do número do dia. Reinicia no dia 1 de cada mês.</p></div></div><button data-action="close-daily">×</button></header><div class="daily-grid">${Array.from({length:31},(_,i)=>i+1).map(day=>{const reward=dailyRewardForDay(day),special=dailyVipDays.has(day),available=!monthComplete&&!claimedToday&&day===nextReward,locked=day>claimedCount&&!available,boostIcon=special?`<img class="daily-shop-boost-icon" src="./assets/ui/v2130/boost-${reward.vipBonus.kind}.png" alt="Boost ${reward.vipBonus.kind}">`:itemVisual(reward.itemDef);return `<article class="${day<=claimedCount?'claimed':''} ${available?'current':''} ${locked?'locked':''} ${special?'vip-day':''}"><b>${day}</b>${special?`<em>VIP · ${reward.vipBonus.kind==='loot'?'LOOT':'XP'} 1H</em>`:''}<span class="daily-item-icon">${boostIcon}</span>${day<=claimedCount?'<i class="daily-claimed-check">✓</i>':''}<small>${dailyRewardLabel(day)}</small></article>`}).join('')}</div><button class="daily-claim" data-vip-daily ${claimedToday||monthComplete?'disabled':''}>${monthComplete?'MÊS COMPLETO':claimedToday?'JÁ COLETADO HOJE':`RESGATAR RECOMPENSA ${nextReward}`}</button></section></div>`;
  }

  function mailAttachmentVisual(mail){
    const a=mail?.attachment||null;
    if(!a)return '<span class="dragon-mail-announcement-icon">📜</span>';
    if(a.kind==='boost')return `<img src="./assets/ui/v2130/boost-${a.boostKind==='loot'?'loot':'xp'}.png" alt="Boost">`;
    if(a.kind==='item'){
      const item=itemCatalog[String(a.itemId||'')];
      return item?itemVisual(item):'<span class="dragon-mail-announcement-icon">🎁</span>';
    }
    if(a.kind==='profile-icon')return `<img src="${profileIconAsset(a.value)}" alt="Ícone de perfil">`;
    if(a.kind==='profile-border'){const asset=profileBorderAsset(a.value);return asset?`<img src="${asset}" alt="Borda de perfil">`:'<span class="dragon-mail-border-preview"></span>';}
    return '<span class="dragon-mail-announcement-icon">✉</span>';
  }
  function mailAttachmentLabel(mail){
    const a=mail?.attachment||null;
    if(!a)return 'Comunicado';
    if(a.kind==='boost')return `Boost de ${a.boostKind==='loot'?'Loot':'XP'} · ${Math.max(1,Math.round(Number(a.durationMs||3600000)/3600000))}h`;
    if(a.kind==='item')return `${Math.max(1,Number(a.qty||1))}x ${itemCatalog[String(a.itemId||'')]?.name||a.itemId}`;
    if(a.kind==='profile-icon')return 'Ícone cosmético de Perfil';
    if(a.kind==='profile-border')return 'Borda cosmética de Perfil';
    return 'Anexo';
  }
  function renderMail(){
    const mails=ensureMailbox(state.profile),now=Date.now();
    return `<div class="ui-overlay-backdrop dragon-mail-overlay"><section class="dragon-mail-window"><header><div><img src="./assets/ui/v2124/mail.jpg" alt="Dragon Mail"><div><h2>DRAGON MAIL</h2><p>Presentes, comunicados e boosts ficam aqui até você decidir resgatar.</p></div></div><button data-action="close-mail">×</button></header><div class="dragon-mail-list">${mails.map(mail=>{const a=mail.attachment||null,action=a?.kind==='boost'?'Ativar':a?.kind==='item'?'Resgatar':'Excluir';return `<article data-mail-id="${escapeHtml(mail.id)}"><div class="dragon-mail-attachment">${mailAttachmentVisual(mail)}</div><div class="dragon-mail-copy"><div><strong>${escapeHtml(mail.title)}</strong><span>${escapeHtml(mailAttachmentLabel(mail))}</span></div><p>${escapeHtml(mail.body||'')}</p><small data-mail-expiry="${escapeHtml(mail.id)}" data-mail-expires-at="${Number(mail.expiresAt||0)}">${escapeHtml(mailRemainingLabel(mail,now))}</small></div><button data-mail-claim="${escapeHtml(mail.id)}">${action}</button></article>`}).join('')||'<div class="dragon-mail-empty"><span>✉</span><b>Nenhum mail no momento.</b><small>Boosts resgatados e presentes do servidor aparecerão aqui.</small></div>'}</div></section></div>`;
  }
  function localClaimMail(mailId){
    const mail=ensureMailbox(state.profile).find(row=>String(row.id)===String(mailId||''));
    if(!mail)return log('Mail não encontrado ou expirado.');
    const a=mail.attachment||null;
    if(!a){removeMail(state.profile,mail.id);persist();render();return;}
    if(a.kind==='boost'){
      const key=a.boostKind==='loot'?'lootBoostUntil':'xpBoostUntil';
      state.profile[key]=Math.max(Date.now(),Number(state.profile[key]||0))+Math.max(1000,Number(a.durationMs||3600000));
      removeMail(state.profile,mail.id);persist();log(`${a.boostKind==='loot'?'Loot':'XP'} Boost ativado.`);render();return;
    }
    if(a.kind==='item'){
      const qty=Math.max(1,Math.trunc(Number(a.qty)||1)),added=addItemToInventory(state,String(a.itemId||''),qty,itemCatalog);
      if(!added?.ok)return log('Sem espaço para receber o presente.');
      removeMail(state.profile,mail.id);persist();render();return;
    }
    if(a.kind==='profile-icon'){const value=String(a.value||'').replace(/[^a-z0-9_-]/gi,'').toLowerCase();if(!value)return;state.profile.unlockedProfileIcons=[...new Set([...(state.profile.unlockedProfileIcons||[]),value])];removeMail(state.profile,mail.id);persist();render();return;}
    if(a.kind==='profile-border'){const value=String(a.value||'').replace(/[^a-z0-9_-]/gi,'').toLowerCase();if(!value)return;state.profile.unlockedProfileBorders=[...new Set([...(state.profile.unlockedProfileBorders||[]),value])];removeMail(state.profile,mail.id);persist();render();return;}
  }

  const gamePassMissions=GAME_PASS_MISSIONS;
  function gamePassLevel(){return gamePassLevelFromXp(state.profile.gamePassXp||0);}
  function gamePassRewardVisual(reward){
    if(Array.isArray(reward?.bundle)){
      const featured=reward.bundle.find(r=>r.cosmeticIcon||r.cosmeticBorder||r.item==='pass_beta_backpack')||reward.bundle[0];
      return `${gamePassRewardVisual(featured)}${reward.bundle.length>1?`<span class="pass-bundle-count">+${reward.bundle.length-1}</span>`:''}`;
    }
    if(reward?.zeni)return '<span class="pass-zeni-icon">🪙</span>';
    if(reward?.boost)return `<img class="pass-shop-boost-icon" src="./assets/ui/v2130/boost-${reward.kind==='loot'?'loot':'xp'}.png" alt="Boost ${reward.kind}">`;
    if(reward?.cosmeticIcon)return '<img class="pass-exclusive-preview" src="./assets/ui/v2114/beta-profile-icon.png" alt="Ícone exclusivo">';
    if(reward?.cosmeticBorder)return '<img class="pass-exclusive-preview" src="./assets/ui/v2114/beta-profile-border.png?v=21.24.5" alt="Borda exclusiva">';
    const item=itemCatalog[reward?.item];return item?itemVisual(item):'<span class="pass-zeni-icon">?</span>';
  }
  function brasiliaDayKey(ts=Date.now()){const d=new Date(Number(ts)-3*3600000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;}
  function brasiliaWeekKey(ts=Date.now()){const d=new Date(Number(ts)-3*3600000);const sunday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-d.getUTCDay()));return `${sunday.getUTCFullYear()}-${String(sunday.getUTCMonth()+1).padStart(2,'0')}-${String(sunday.getUTCDate()).padStart(2,'0')}`;}
  function emptyGamePassStats(key=null){return {...(key?{key}:{}),kills:0,bosses:0,xp:0,drops:0,supplies:0};}
  function ensureLocalGamePassState(){
    state.profile.gamePassStats ||= emptyGamePassStats();
    state.profile.gamePassDailyStats ||= emptyGamePassStats(brasiliaDayKey());
    state.profile.gamePassWeeklyStats ||= emptyGamePassStats(brasiliaWeekKey());
    if(state.profile.gamePassDailyStats.key!==brasiliaDayKey())state.profile.gamePassDailyStats=emptyGamePassStats(brasiliaDayKey());
    if(state.profile.gamePassWeeklyStats.key!==brasiliaWeekKey())state.profile.gamePassWeeklyStats=emptyGamePassStats(brasiliaWeekKey());
    state.profile.gamePassXp=Math.max(0,Number(state.profile.gamePassXp||0));
    state.profile.gamePassClaimedMissions=Array.isArray(state.profile.gamePassClaimedMissions)?state.profile.gamePassClaimedMissions:[];
    state.profile.gamePassClaimedFree=Array.isArray(state.profile.gamePassClaimedFree)?state.profile.gamePassClaimedFree:[];
    state.profile.gamePassClaimedPremium=Array.isArray(state.profile.gamePassClaimedPremium)?state.profile.gamePassClaimedPremium:[];
  }
  function missionClaimKey(m){return m.scope==='daily'?`${m.id}:${brasiliaDayKey()}`:m.scope==='weekly'?`${m.id}:${brasiliaWeekKey()}`:m.id;}
  function missionStats(m){return m.scope==='daily'?state.profile.gamePassDailyStats:m.scope==='weekly'?state.profile.gamePassWeeklyStats:state.profile.gamePassStats;}
  function localClaimGamePassMission(missionId){
    ensureLocalGamePassState();const mission=gamePassMissions.find(entry=>entry.id===String(missionId||''));if(!mission)return log('Missão do Game Pass inválida.');
    const key=missionClaimKey(mission);if(state.profile.gamePassClaimedMissions.includes(key))return;
    if(Number(missionStats(mission)?.[mission.key]||0)<mission.target)return log('Missão ainda não concluída.');
    state.profile.gamePassClaimedMissions.push(key);state.profile.gamePassXp+=mission.xp;persist();log(`+${mission.xp} XP de Game Pass.`);render();
  }
  function grantLocalGamePassReward(reward){
    if(!reward)return false;
    if(Array.isArray(reward.bundle))return reward.bundle.every(grantLocalGamePassReward);
    if(reward.zeni){state.profile.bank=Math.max(0,Number(state.profile.bank||0))+reward.zeni;return true;}
    if(reward.boost){addMail(state.profile,{kind:'boost',title:`Boost de ${reward.kind==='loot'?'Loot':'XP'}`,body:'Recompensa do Game Pass. Use quando quiser; este mail não expira.',attachment:{kind:'boost',boostKind:reward.kind,durationMs:Number(reward.durationMs||3600000)}});return true;}
    if(reward.cosmeticIcon){state.profile.unlockedProfileIcons=[...new Set([...(state.profile.unlockedProfileIcons||[]),reward.cosmeticIcon])];state.profile.profileIcon=reward.cosmeticIcon;return true;}
    if(reward.cosmeticBorder){state.profile.unlockedProfileBorders=[...new Set([...(state.profile.unlockedProfileBorders||[]),reward.cosmeticBorder])];state.profile.profileBorder=reward.cosmeticBorder;return true;}
    const added=addItemToInventory(state,reward.item,reward.qty,itemCatalog);return Boolean(added?.ok);
  }
  function localClaimGamePassTier(track,tier){
    ensureLocalGamePassState();tier=Math.max(1,Math.trunc(Number(tier)||0));const premium=track==='premium';if(tier>gamePassLevel())return log('Este tier ainda não foi desbloqueado.');if(premium&&!state.profile.gamePass)return log('Compre o Game Pass na Loja VIP para liberar a trilha do Passe.');
    if(premium&&tier>GAME_PASS_BASE_LEVELS)return log('Após o nível 45, a recompensa infinita fica somente na trilha Free.');
    const claimed=premium?state.profile.gamePassClaimedPremium:state.profile.gamePassClaimedFree;if(claimed.map(Number).includes(tier))return;const reward=gamePassRewardFor(premium?'premium':'free',tier);if(!reward)return log('Sem recompensa neste tier.');if(!grantLocalGamePassReward(reward))return log('Sem espaço para receber a recompensa do Game Pass.');claimed.push(tier);persist();log(`Tier ${tier} ${premium?'Passe':'Free'}: ${gamePassRewardLabel(reward,itemCatalog)}.`);render();
  }
  function renderGamePass(){
    ensureLocalGamePassState();const claimedMissions=new Set(state.profile.gamePassClaimedMissions||[]),free=new Set((state.profile.gamePassClaimedFree||[]).map(Number)),premium=new Set((state.profile.gamePassClaimedPremium||[]).map(Number));
    const lvl=gamePassLevel(),rawXp=Math.max(0,Number(state.profile.gamePassXp||0)),xpPerLevel=GAME_PASS_XP_PER_LEVEL,xpIntoLevel=rawXp%xpPerLevel,xpNeeded=xpPerLevel-xpIntoLevel,xpPct=Math.min(100,(xpIntoLevel/xpPerLevel)*100);
    const missionScopeOrder={daily:0,weekly:1,season:2};
    const missions=gamePassMissions.map(mission=>{const stats=missionStats(mission)||{},value=Math.min(mission.target,Number(stats[mission.key]||0)),key=missionClaimKey(mission),claimed=claimedMissions.has(key),done=value>=mission.target;return {...mission,value,key,claimed,done,sort:claimed?2:done?0:1};}).sort((a,b)=>a.sort-b.sort||(missionScopeOrder[a.scope]??9)-(missionScopeOrder[b.scope]??9)||a.target-b.target);
    const rewardCell=(track,tier)=>{const isPremium=track==='premium',reward=gamePassRewardFor(track,tier);if(!reward)return `<div class="pass-reward-mini ${isPremium?'premium':'free'} empty"><span>—</span><strong>${tier>45?'PÓS-45':'Sem prêmio'}</strong></div>`;const claimed=(isPremium?premium:free).has(tier),trackOwned=!isPremium||Boolean(state.profile.gamePass),unlocked=tier<=lvl&&trackOwned,claimable=unlocked&&!claimed,locked=!unlocked&&!claimed,status=claimed?'✓':claimable?'RESGATAR':isPremium&&!state.profile.gamePass?'🔒':'🔒';return `<button class="pass-reward-mini ${isPremium?'premium':'free'} ${claimed?'claimed':''} ${claimable?'claimable':''} ${locked?'locked':''}" data-pass-claim="${track}|${tier}" ${claimable?'':'disabled'} title="${escapeHtml(gamePassRewardLabel(reward,itemCatalog))}"><span class="pass-reward-icon">${gamePassRewardVisual(reward)}</span><strong>${escapeHtml(gamePassRewardLabel(reward,itemCatalog))}</strong><em>${status}</em></button>`;};
    const visibleMax=lvl>GAME_PASS_BASE_LEVELS?Math.max(GAME_PASS_BASE_LEVELS,Math.min(lvl+5,Math.max(50,lvl))):GAME_PASS_BASE_LEVELS;const tiers=Array.from({length:visibleMax},(_,i)=>i+1);
    const rewardsPanel=`<div class="pass-reward-layout"><div class="pass-track-labels"><div class="pass-tier-spacer">NÍVEL</div><div class="premium"><span>🎟</span><b>PASSE</b></div><div class="free"><span>🎫</span><b>FREE</b></div></div><div class="pass-reward-scroll" data-preserve-scroll="game-pass-rewards"><div class="pass-tier-columns">${tiers.map(tier=>`<div class="pass-tier-column ${tier===lvl?'current':''} ${tier>GAME_PASS_BASE_LEVELS?'infinite-tier':''}"><b class="pass-tier-number">${tier}</b>${rewardCell('premium',tier)}${rewardCell('free',tier)}</div>`).join('')}</div></div></div><p class="pass-infinite-note">Níveis 1–45 formam a temporada. Após o 45, cada nível adicional entrega <b>10 Shenlong Senzu</b> na trilha Free, sem limite máximo.</p>`;
    const missionsPanel=`<div class="pass-mission-board">${missions.map(m=>`<article class="${m.claimed?'claimed':m.done?'claimable':''}"><div><span class="pass-mission-scope ${m.scope}">${m.scope==='daily'?'DIÁRIA':m.scope==='weekly'?'SEMANAL':'TEMPORADA'}</span><strong>${escapeHtml(m.label)}</strong><div class="pass-progress"><i style="width:${Math.min(100,m.value/m.target*100)}%"></i></div><small>${Math.floor(m.value).toLocaleString('pt-BR')}/${m.target.toLocaleString('pt-BR')} · +${m.xp} XP</small></div><button data-pass-mission="${m.id}" ${!m.done||m.claimed?'disabled':''}>${m.claimed?'Resgatado':m.done?'Resgatar':'Em progresso'}</button></article>`).join('')}</div><div class="pass-reset-note">Missões de temporada permanecem até o fim do Passe. Diárias resetam 00:00. Semanais resetam domingo 00:00 (sábado → domingo), horário de Brasília.</div>`;
    return `<div class="ui-overlay-backdrop compact-overlay"><section class="game-pass-window battle-pass-style"><header><div><img class="pass-header-icon" src="./assets/ui/v2130/gamepass.png" alt=""><div><h2>PASSE DE BATALHA</h2><p>${state.profile.gamePass?'Passe comprado · Free + Passe':'Trilha Free ativa · compre o Game Pass para liberar a trilha Passe'}</p></div></div><button data-action="close-game-pass">×</button></header><div class="pass-season-summary"><div><b>Forgotten Lands · BETA SEASON</b><span>Nível ${lvl}${lvl>GAME_PASS_BASE_LEVELS?' · PROGRESSÃO INFINITA':''}</span></div><div class="pass-level-progress"><div class="pass-level-progress-fill" style="width:${xpPct}%"></div><strong>${Math.floor(xpIntoLevel)}/${xpPerLevel} XP</strong></div><small>Faltam ${Math.ceil(xpNeeded)} XP para o próximo nível · ${Math.floor(rawXp).toLocaleString('pt-BR')} XP total</small>${lvl<GAME_PASS_BASE_LEVELS?`<button class="pass-buy-level" data-pass-buy-level>Comprar próximo nível · 10 PP</button>`:'<span class="pass-buy-level-cap">Compra de nível encerrada no Lv45.</span>'}</div><nav class="pass-tabs"><button data-game-pass-tab="rewards" class="${gamePassTab==='rewards'?'active':''}">Recompensas</button><button data-game-pass-tab="missions" class="${gamePassTab==='missions'?'active':''}">Missões</button></nav><div class="pass-tab-content">${gamePassTab==='missions'?missionsPanel:rewardsPanel}</div></section></div>`;
  }

  function bestiaryMonsterCatalog(){
    const seen=new Map();
    for(const zone of zones){
      if(zone.questType==='reborn'||zone.hiddenFromHuntList||zone.disabledForHunt||zone.guildBoss||zone.contentType==='boss'||zone.contentType==='guild-boss')continue;
      for(const monster of zone.monsters||[]){
        const id=String(monster.id||monster.name||'');
        if(!id||seen.has(id))continue;
        seen.set(id,{monster,level:Number(monster.requiredLevel||zone.level||1),vipOnly:Boolean(zone.vipOnly)});
      }
    }
    return [...seen.values()].sort((a,b)=>a.level-b.level||String(a.monster.name).localeCompare(String(b.monster.name),'pt-BR'));
  }
  function bestiaryBossCatalog(){
    const seen=new Map();
    for(const zone of zones){
      // O Bestiário de Bosses usa exclusivamente a aba Boss das Hunts.
      // Bosses de quests/reborn e Guild Bosses não entram neste catálogo.
      if(zone.contentType!=='boss'||zone.questType||zone.guildBoss||zone.hiddenFromHuntList||zone.disabledForHunt)continue;
      for(const monster of zone.monsters||[]){
        const id=String(monster.id||monster.name||'');
        if(!id||seen.has(id))continue;
        seen.set(id,{monster,level:Number(monster.requiredLevel||zone.level||1),vipOnly:Boolean(zone.vipOnly)});
      }
    }
    return [...seen.values()].sort((a,b)=>a.level-b.level||String(a.monster.name).localeCompare(String(b.monster.name),'pt-BR'));
  }
  function renderBestiary(){
    ensureBestiaryState(state);
    const bossMode=bestiaryTab==='bosses';
    const available=bossMode?bossBestiaryAvailablePoints(state):bestiaryAvailablePoints(state);
    const earned=bossMode?bossBestiaryEarnedPoints(state):bestiaryEarnedPoints(state);
    const catalog=bossMode?bestiaryBossCatalog():bestiaryMonsterCatalog();
    const query=bestiarySearch.trim().toLowerCase();
    const records=catalog.filter(x=>!query||String(x.monster.name).toLowerCase().includes(query));
    const upgrades=bossMode?BOSS_BESTIARY_UPGRADES:BESTIARY_UPGRADES;
    const upgradeState=bossMode?(state.bestiary.bossUpgrades||{}):(state.bestiary.upgrades||{});
    const maxPoints=bossMode?bossBestiaryMaximumPoints(catalog.length):bestiaryMaximumPoints(catalog.length);
    const title=bossMode?'BESTIÁRIO DE BOSSES':'BESTIÁRIO';
    const description=bossMode?'Somente bosses da aba Boss das Hunts. Bosses de Quest e da Guild não entram neste Bestiário.':'Complete registros de monstros e transforme conhecimento em atributos permanentes.';
    const upgradesHtml=Object.entries(upgrades).map(([key,def])=>{
      const rank=Number(upgradeState?.[key]||0),cost=bossMode?bossBestiaryUpgradeCostForRank(rank):bestiaryUpgradeCostForRank(rank),max=rank>=def.maxRank;
      const total=(rank*def.effectPerRank).toLocaleString('pt-BR',{maximumFractionDigits:2});
      const attr=bossMode?'data-boss-bestiary-upgrade':'data-bestiary-upgrade';
      return `<article><strong>${escapeHtml(def.short||key.toUpperCase())} · ${escapeHtml(def.name)}</strong><span>Nv ${rank}/${def.maxRank} · +${total} ${escapeHtml(def.unit||'')}</span><small>${escapeHtml(def.description||'')}</small><button ${attr}="${key}" ${max||available<cost?'disabled':''}>${max?'MÁXIMO':`+1 · ${cost} PTS`}</button></article>`;
    }).join('');
    const recordHtml=records.map(({monster,level,vipOnly})=>{
      const progress=bossMode?bossBestiaryMonsterProgress(state,monster.id||monster.name):bestiaryMonsterProgress(state,monster.id||monster.name);
      const next=progress.next,pct=next?Math.min(100,progress.kills/next.kills*100):100;
      const maximum=(bossMode?BOSS_BESTIARY_MILESTONES:BESTIARY_MILESTONES).reduce((sum,m)=>sum+m.points,0);
      return `<article class="${progress.complete?'complete':''}">${monsterImage(monster,'bestiary-monster')}<div><strong>${escapeHtml(monster.name)}</strong><small>Lv ${level}${bossMode?' · BOSS':''}${vipOnly?' · VIP':''}</small><div class="bestiary-progress"><i style="width:${pct}%"></i></div><span>${progress.kills.toLocaleString('pt-BR')} kills · ${progress.points}/${maximum} pts</span><em>${next?`Próximo: ${next.kills.toLocaleString('pt-BR')} kills (+${next.points})`:'Registro completo'}</em></div></article>`;
    }).join('');
    return `<div class="ui-overlay-backdrop bestiary-overlay"><section class="bestiary-window">
      <header><div><span>📖</span><div><h2>${title}</h2><p>${description}</p></div></div><button data-action="close-bestiary">×</button></header>
      <nav class="bestiary-tabs"><button data-bestiary-tab="monsters" class="${!bossMode?'active':''}">Monstros</button><button data-bestiary-tab="bosses" class="${bossMode?'active':''}">Bosses</button></nav>
      <div class="bestiary-summary"><div><b>${available}</b><span>Pontos disponíveis</span></div><div><b>${earned}/${maxPoints}</b><span>Pontos conquistados</span></div><div><b>${bossMode?catalog.filter(({monster})=>bossBestiaryMonsterProgress(state,monster.id||monster.name).kills>0).length:Object.keys(state.bestiary.kills||{}).length}</b><span>${bossMode?'Bosses encontrados':'Monstros encontrados'}</span></div></div>
      <section class="bestiary-upgrades"><h3>${bossMode?'UPGRADES DE SKILLS · PONTOS DE BOSS':'UPGRADES DE STATUS'}</h3><div>${upgradesHtml}</div></section>
      <section class="bestiary-records"><div class="bestiary-record-title"><h3>REGISTROS</h3><input data-bestiary-search data-preserve-focus="bestiary-search" placeholder="${bossMode?'Buscar boss':'Buscar monstro'}" value="${escapeHtml(bestiarySearch)}"></div><div class="bestiary-grid">${recordHtml||`<p>Nenhum ${bossMode?'boss':'monstro'} encontrado.</p>`}</div></section>
    </section></div>`;
  }

  const guildTechUi=Object.freeze({
    research_accelerated:{name:'Devoção Reconhecida',icon:'./assets/ui/v2190/technologies/devocao-reconhecida.png',maxLevel:5,description:'+2% XP de Guild em toda conversão/doação que gera XP por nível.'},
    efficient_vault:{name:'Dízimo da Prosperidade',icon:'./assets/ui/v2190/technologies/dizimo-prosperidade.png',maxLevel:5,description:'+2% XP de Guild nas doações de Gold por nível.'},
    hunter_instinct:{name:'Favorecimento dos Deuses',icon:'./assets/ui/v2190/technologies/favorecimento-deuses.png',maxLevel:5,description:'+1% Drop base para todos os membros por nível.'},
    more_members:{name:'Chamado do Destino',icon:'./assets/ui/v2190/technologies/chamado-destino.png',maxLevel:4,description:'+5 vagas de membro por nível.'},
    battle_training:{name:'Bênção do Conhecimento',icon:'./assets/ui/v2190/technologies/bencao-conhecimento.png',maxLevel:5,description:'+1% XP de personagem para todos os membros por nível.'},
    boss_slayer:{name:'Bênção do Abate',icon:'./assets/ui/v2190/technologies/bencao-abate.png',maxLevel:5,description:'+2% loot-base do Boss da Guild por nível.'}
  });
  function projectedGuildBenefits(level,tech={}){
    const lv=Math.max(1,Math.min(50,Number(level)||1));const levelBonus=Math.min(20,Math.floor(lv*.4));
    return {memberLimit:10+lv*2+Number(tech.more_members||0)*5,xpPercent:levelBonus+Number(tech.battle_training||0),dropPercent:levelBonus+Number(tech.hunter_instinct||0),bossLootPercent:Number(tech.boss_slayer||0)*2};
  }
  function guildNumber(value){return Math.max(0,Number(value)||0).toLocaleString('pt-BR')}
  function guildRoleLabel(role){return ({leader:'Líder',vice:'Vice',member:'Membro',recruit:'Recruta'})[role]||'Membro'}
  function guildOfficer(){return ['leader','vice'].includes(String(guildData?.role||''))}
  async function loadGuildData(force=false){
    if(guildLoading||!guildOpen||(!force&&guildData))return;
    guildLoading=true;if(force)guildMessage='';render();
    try{
      const result=await marketApi(`/api/guild?characterId=${encodeURIComponent(state.profile.id)}`);
      guildData=result;if(result.state)applyAuthoritativeState(result.state);
    }catch(error){guildData=null;guildMessage=error.message||'Não foi possível carregar a Guild.';}
    finally{guildLoading=false;if(guildOpen)render();}
  }
  async function guildMutate(path,payload={}){
    guildLoading=true;guildMessage='';render();
    try{
      const result=await marketApi(path,{method:'POST',body:JSON.stringify({characterId:state.profile.id,...payload})});
      if(result.state)applyAuthoritativeState(result.state);guildMessage=result.message||'Operação concluída.';guildLoading=false;guildData=null;await loadGuildData(true);
    }catch(error){guildLoading=false;guildMessage=error.message||'Falha na operação da Guild.';render();}
  }
  async function acceptGuildBossInvite(){
    const invite=guildBossInvite;if(!invite?.runId)return;
    try{
      const result=await marketApi('/api/guild/boss/accept',{method:'POST',body:JSON.stringify({characterId:state.profile.id,runId:invite.runId})});
      guildBossAcceptedCountdown={runId:String(invite.runId),startsAt:new Date(invite.startsAt||Date.now()).getTime(),bossType:String(invite.bossType||'daishinkan'),bossName:String(invite.bossName||'Boss da Guild')};
      guildBossInvite=null;guildBossEventMessage=result.message||'Convite aceito.';log(guildBossEventMessage);render();
    }catch(error){guildBossEventMessage=error.message||'Não foi possível aceitar o Boss da Guild.';log(guildBossEventMessage);render();}
  }
  function guildRankingTable(rows=[],joinable=false,mode='level'){
    const pending=new Set((guildData?.pendingRequestGuildIds||[]).map(String));
    const bossMode=mode==='bosses';
    const ordered=bossMode?[...(rows||[])].sort((a,b)=>Number(b.bossBestiaryPoints||0)-Number(a.bossBestiaryPoints||0)||Number(b.bossWins||0)-Number(a.bossWins||0)||Number(b.level||0)-Number(a.level||0)):(rows||[]);
    const head=bossMode?`<div class="guild-ranking-head"><span>#</span><span>Guild</span><span>Pontos Boss</span><span>Bosses vencidos</span><span>Nível</span><span>XP total</span>${joinable?'<span></span>':''}</div>`:`<div class="guild-ranking-head"><span>#</span><span>Guild</span><span>Nível</span><span>XP total</span><span>Membros</span><span>Gold destruído</span>${joinable?'<span></span>':''}</div>`;
    const body=ordered.slice(0,100).map((row,index)=>{
      const pos=bossMode?index+1:row.position;
      const core=bossMode?`<b>${pos}</b><strong>${escapeHtml(row.name)} <em>[${escapeHtml(row.tag)}]</em></strong><span>${guildNumber(row.bossBestiaryPoints||0)}</span><span>${guildNumber(row.bossWins||0)}</span><span>${row.level}</span><span>${guildNumber(row.lifetimeXp)}</span>`:`<b>${pos}</b><strong>${escapeHtml(row.name)} <em>[${escapeHtml(row.tag)}]</em></strong><span>${row.level}</span><span>${guildNumber(row.lifetimeXp)}</span><span>${row.members}</span><span>${guildNumber(row.goldBurned)}</span>`;
      return `<div class="guild-ranking-row ${row.guildId===guildData?.guild?.id?'mine':''}">${core}${joinable?`<button data-guild-join="${escapeHtml(row.guildId)}" ${pending.has(String(row.guildId))?'disabled':''}>${pending.has(String(row.guildId))?'Solicitado':'Solicitar entrada'}</button>`:''}</div>`;
    }).join('');
    return `<div class="guild-ranking-table ${joinable?'joinable':''} ${bossMode?'boss-ranking':''}">${head}${body||'<p class="guild-empty">Nenhuma guild criada ainda.</p>'}</div>`;
  }

  function renderGuildLobby(){
    const ranking=guildData?.ranking||[],pp=Number(state.profile.premiumPoints??state.profile.vipCredits??0);
    return `<div class="guild-lobby"><section class="guild-create-card"><div class="guild-create-logo"><img src="./assets/ui/v2180/guild.png" alt="Guild"></div><div><small>COMECE SUA COMUNIDADE</small><h2>Crie uma Guild</h2><p>Criação custa <b>50 PP</b>. Depois, membros podem contribuir com Gold e PP para fortalecer a Guild.</p><p class="guild-cost-note">PP disponíveis: <b>${guildNumber(pp)}</b></p></div><form data-guild-create><label>Nome<input name="name" maxlength="32" minlength="3" placeholder="Ex.: Guerreiros Z" required></label><label>Tag<input name="tag" maxlength="6" minlength="2" placeholder="DBO" required></label><button ${guildLoading||pp<50?'disabled':''}>Criar Guild · 50 PP</button></form></section><section class="guild-browse"><header><div><small>GUILDS PÚBLICAS</small><h3>Ranking e solicitações</h3></div><button data-guild-refresh>Atualizar</button></header>${guildRankingTable(ranking,true)}</section></div>`;
  }
  function renderGuildOverview(){
    const g=guildData.guild,b=g.benefits||{},next=projectedGuildBenefits(Math.min(50,g.level+1),g.technologies||{}),pct=g.xpRequired?Math.min(100,g.xp/g.xpRequired*100):100;
    return `<div class="guild-overview"><div class="guild-stat-grid"><article><span>⭐</span><b>${g.level}</b><small>Nível</small></article><article><span>👥</span><b>${g.membersCount}/${b.memberLimit}</b><small>Membros</small></article><article><span>◆</span><b>${guildNumber(g.guildPoints)}</b><small>Guild Points</small></article><article><span>👑</span><b>${escapeHtml((guildData.members||[]).find(m=>m.characterId===g.leaderCharacterId)?.name||'Líder')}</b><small>Líder</small></article></div><div class="guild-xp-line"><div><strong>XP da Guild</strong><span>${g.level>=50?'Nível máximo':`${guildNumber(g.xp)} / ${guildNumber(g.xpRequired)} XP`}</span></div><div class="guild-xp-bar"><i style="width:${pct}%"></i></div><b>${Math.floor(pct)}%</b></div><section class="guild-motd"><span>📣</span><div><b>Mensagem do dia</b><p>${escapeHtml(g.messageOfDay||'Bem-vindos!')}</p></div></section><p class="guild-burn-note"><b>Gold</b> doado é queimado imediatamente e gera XP. <b>PP</b> doado vai para o Cofre e só é queimado quando Líder/Vice converter para XP ou invocar o Boss da Guild.</p><div class="guild-donation-grid"><form data-guild-donate="gold"><div class="guild-donation-title"><span>🪙</span><div><b>Doar Gold</b><small>1.000 Gold = 10 XP base da Guild</small></div></div><input name="amount" type="number" min="1000" step="1000" value="1000000"><small>Disponível: ${guildNumber(state.profile.bank)} Zeni</small><button ${guildLoading?'disabled':''}>Doar Gold</button></form><form data-guild-donate="premium"><div class="guild-donation-title">${ppIconHtml('guild-pp')}<div><b>Doar PP</b><small>Depósito no Cofre · somente de 10 em 10</small></div></div><input name="amount" type="number" min="10" step="10" value="10"><small>Disponível: ${guildNumber(state.profile.premiumPoints??state.profile.vipCredits)} PP</small><button ${guildLoading?'disabled':''}>Doar PP ao Cofre</button></form></div><section class="guild-next-benefits"><h3>Benefícios ${g.level>=50?'máximos':`do próximo nível (${g.level+1})`}</h3><div><article><span>👥</span><div><b>Limite de membros</b><small>${b.memberLimit} ${g.level>=50?'vagas':`→ ${next.memberLimit} vagas`}</small></div></article><article><span>XP</span><div><b>Bônus de XP</b><small>+${b.xpPercent}% ${g.level>=50?'':`→ +${next.xpPercent}%`}</small></div></article><article><span>🎲</span><div><b>Bônus de Drop</b><small>+${b.dropPercent}% ${g.level>=50?'':`→ +${next.dropPercent}%`}</small></div></article></div></section></div>`;
  }
  function renderGuildMembers(){
    const leader=guildData.role==='leader',officer=guildOfficer(),apps=guildData.applications||[],viceCount=(guildData.members||[]).filter(m=>m.role==='vice').length;
    return `<section class="guild-panel guild-members-panel"><header><div><h3>Membros</h3><p>Cargos: Recruta · Membro · Vice · Líder. Máximo de 4 Vices.</p></div><span>${guildData.guild.membersCount}/${guildData.guild.benefits.memberLimit}</span></header>${officer?`<section class="guild-applications"><div class="guild-section-title"><h4>Solicitações de entrada</h4><span>${apps.length} pendente(s)</span></div>${apps.length?apps.map(a=>`<article><div class="guild-member-avatar">📨</div><div><strong>${escapeHtml(a.name)}</strong><small>Level ${a.level} · solicitou ${new Date(a.requestedAt).toLocaleString('pt-BR')}</small></div><div class="guild-application-actions"><button data-guild-application="approve" data-character-id="${escapeHtml(a.characterId)}">Aprovar</button><button class="danger" data-guild-application="deny" data-character-id="${escapeHtml(a.characterId)}">Recusar</button></div></article>`).join(''):'<p class="guild-empty">Nenhuma solicitação pendente.</p>'}</section>`:''}<div class="guild-section-title"><h4>Lista de membros</h4><span>${viceCount}/4 Vices</span></div><div class="guild-members-list">${(guildData.members||[]).map(m=>`<article><div class="guild-member-avatar">${m.role==='leader'?'👑':m.role==='vice'?'🛡':m.role==='recruit'?'🌱':'⚔'}</div><div><strong>${escapeHtml(m.name)}</strong><small>${guildRoleLabel(m.role)} · Lv ${m.level}</small></div><span>${guildNumber(m.contributedXp)} XP contribuído</span>${leader&&m.role!=='leader'?`<select data-guild-role="${escapeHtml(m.characterId)}"><option value="recruit" ${m.role==='recruit'?'selected':''}>Recruta</option><option value="member" ${m.role==='member'?'selected':''}>Membro</option><option value="vice" ${m.role==='vice'?'selected':''}>Vice</option></select><button class="danger" data-guild-kick="${escapeHtml(m.characterId)}">Remover</button>`:''}</article>`).join('')}</div>${!officer?'<p class="guild-permission-note">Somente Líder e Vices veem e aprovam solicitações de entrada.</p>':''}</section>`;
  }
  function renderGuildContributions(){
    const rows=[...(guildData.members||[])].sort((a,b)=>b.contributedXp-a.contributedXp);return `<section class="guild-panel"><header><h3>Contribuições</h3><span>Gold queimado · PP depositado · XP gerado</span></header><div class="guild-contribution-table"><div><b>#</b><b>Jogador</b><b>Gold</b><b>PP ao Cofre</b><b>XP de Guild</b></div>${rows.map((m,i)=>`<div><span>${i+1}</span><strong>${escapeHtml(m.name)}</strong><span>${guildNumber(m.contributedGold)}</span><span>${guildNumber(m.contributedPp)}</span><span>${guildNumber(m.contributedXp)}</span></div>`).join('')}</div></section>`;
  }
  function renderGuildVault(){
    const g=guildData.guild,officer=guildOfficer();return `<section class="guild-panel guild-vault"><header><div><h3>Cofre da Guild</h3><p>PP doado fica guardado até Líder/Vice escolher como queimá-lo.</p></div></header><div class="guild-vault-grid"><article>${ppIconHtml('guild-vault-pp')}<b>${guildNumber(g.ppVault)}</b><small>PP disponíveis no Cofre</small></article><article><span>🔥</span><b>${guildNumber(g.ppBurned)}</b><small>PP já queimados</small></article><article><span>🪙</span><b>${guildNumber(g.goldBurned)}</b><small>Gold já queimado</small></article><article><span>◆</span><b>${guildNumber(g.lifetimeXp)}</b><small>XP total da Guild</small></article></div><div class="guild-vault-rule"><b>Destino dos PP</b><span>Converter em XP: 1 PP = 1.000 XP base</span><span>Invocar Boss da Guild: 100 PP</span><small>PP usado no Boss é queimado e <b>não gera XP</b>.</small></div>${officer?`<form class="guild-convert-form" data-guild-convert-pp><label>PP para converter<input name="amount" type="number" min="10" step="10" value="10" max="${Math.max(10,Number(g.ppVault||0))}"></label><button ${g.ppVault<10||guildLoading?'disabled':''}>Queimar PP e virar XP</button></form>`:'<p class="guild-permission-note">Somente Líder e Vice podem converter PP do Cofre.</p>'}</section>`;
  }
  function renderGuildTechnologies(){
    const g=guildData.guild,officer=guildOfficer();return `<section class="guild-panel guild-technologies"><header><div><h3>Tecnologias</h3><p>Líder e Vices podem usar Guild Points conquistados ao subir de nível.</p></div><b>⭐ ${guildNumber(g.guildPoints)} pontos</b></header><div class="guild-tech-grid">${Object.entries(guildTechUi).map(([id,def])=>{const lv=Number(g.technologies?.[id]||0),max=lv>=def.maxLevel,cost=max?0:lv+1;return `<article class="${max?'maxed':''}"><span class="guild-tech-icon"><img src="${def.icon}" alt="${escapeHtml(def.name)}"></span><div><h4>${def.name}</h4><b>${lv}/${def.maxLevel}</b><p>${def.description}</p><small>${max?'Nível máximo':`Próximo: ${cost} ponto(s)`}</small></div><button data-guild-tech="${id}" ${!officer||max||g.guildPoints<cost?'disabled':''}>${max?'MAX':`Pesquisar ${cost}`}</button></article>`}).join('')}</div>${!officer?'<p class="guild-permission-note">Somente Líder e Vice podem gastar Guild Points.</p>':''}</section>`;
  }
  function renderGuildBuffs(){const b=guildData.guild.benefits;return `<section class="guild-panel guild-buffs"><header><div><h3>Buffs da Guild</h3><p>Aplicados automaticamente a todos os membros.</p></div></header><div class="guild-buff-grid"><article><span>XP</span><b>+${b.xpPercent}%</b><small>Experiência recebida em combate</small></article><article><span>🎲</span><b>+${b.dropPercent}%</b><small>Chance de loot base</small></article><article><span>👥</span><b>${b.memberLimit}</b><small>Limite de membros</small></article><article><span>🔥</span><b>+${b.donationXpPercent}%</b><small>XP em conversões/doações</small></article><article><span>🪙</span><b>+${b.goldDonationXpPercent}%</b><small>XP extra em Gold</small></article><article><span>⚔</span><b>+${b.bossLootPercent||0}%</b><small>Loot-base do Boss da Guild</small></article><article><span>🗡</span><b>+${b.guildBossAttackPercent||0}%</b><small>Dano contra Bosses da Guild</small></article><article><span>🛡</span><b>+${b.guildBossDefensePercent||0}%</b><small>Defesa contra Bosses da Guild</small></article><article><span>🐉</span><b>+${Number(b.guildBossDragonBallBonus||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} p.p.</b><small>Chance de cada Esfera em Bosses da Guild</small></article></div><p class="guild-permission-note">Os bônus normais de Drop e Bênção do Abate não afetam Esferas do Dragão. Somente o <b>Favor de Shenlong</b>, no Bestiário de Bosses da Guild, aumenta a chance das Esferas.</p></section>`;}
  function renderGuildBossBestiary(){
    const g=guildData.guild,b=g.bossBestiary||{kills:{},upgrades:{}},available=Number(g.bossBestiaryAvailablePoints||0),earned=Number(g.bossBestiaryPoints||0),officer=guildOfficer();
    const defs={
      attack:{name:'Poder de Extermínio',icon:'⚔',max:5,effect:2,unit:'%',description:'+2% de dano contra Bosses da Guild por nível.'},
      defense:{name:'Muralha da Guild',icon:'🛡',max:5,effect:2,unit:'%',description:'+2% de redução de dano recebido dos Bosses da Guild por nível.'},
      dragonBall:{name:'Favor de Shenlong',icon:'🐉',max:5,effect:.2,unit:' p.p.',description:'+0,2 ponto percentual na chance de cada Esfera do Dragão por nível. É o único bônus da Guild aplicado às Esferas.'}
    };
    const milestone=(kills)=>[{kills:1,points:1},{kills:5,points:2},{kills:15,points:3},{kills:50,points:4}].reduce((sum,m)=>sum+(kills>=m.kills?m.points:0),0);
    return `<section class="guild-panel guild-boss-bestiary"><header><div><h3>Bestiário · Bosses da Guild</h3><p>Derrote Champa e Daishinkan em equipe. Os pontos pertencem à Guild e só podem ser gastos aqui.</p></div><div class="guild-boss-bestiary-points"><b>${available}</b><span>disponíveis</span><small>${earned} conquistados</small></div></header>
      <div class="guild-boss-bestiary-records"><article><img src="./assets/generated/vip-portraits/vip-champa-683.png" alt="Champa"><div><strong>Champa</strong><span>${guildNumber(b.kills?.champa||0)} vitórias</span><small>${milestone(Number(b.kills?.champa||0))}/10 pts possíveis</small></div></article><article><img src="./assets/generated/exact-transformations/portraits/758.png" alt="Daishinkan"><div><strong>Daishinkan</strong><span>${guildNumber(b.kills?.daishinkan||0)} vitórias</span><small>${milestone(Number(b.kills?.daishinkan||0))}/10 pts possíveis</small></div></article></div>
      <div class="guild-boss-bestiary-upgrades">${Object.entries(defs).map(([key,def])=>{const rank=Number(b.upgrades?.[key]||0),max=rank>=def.max;return `<article><span class="guild-boss-bestiary-upgrade-icon">${def.icon}</span><div><strong>${def.name}</strong><b>Nv ${rank}/${def.max} · +${(rank*def.effect).toLocaleString('pt-BR',{maximumFractionDigits:1})}${def.unit}</b><small>${def.description}</small></div><button data-guild-boss-bestiary-upgrade="${key}" ${!officer||max||available<1||guildLoading?'disabled':''}>${max?'MÁXIMO':'+1 · 1 PT'}</button></article>`}).join('')}</div>
      ${!officer?'<p class="guild-permission-note">Somente Líder e Vice podem gastar os pontos do Bestiário de Bosses da Guild.</p>':''}
    </section>`;
  }
  function renderGuildBoss(){
    const g=guildData.guild,run=guildData.bossRun,officer=guildOfficer(),role=String(guildData.role||''),canChampa=role!=='recruit',lootBonus=Number(g.benefits?.bossLootPercent||0),starts=run?.startsAt?new Date(run.startsAt).getTime():0,seconds=Math.max(0,Math.ceil((starts-Date.now())/1000));
    const tickets=['boss_ticket_champa','boss_ticket_golden_freeza','boss_ticket_zamasu','boss_ticket_liquer','boss_ticket_vermouth'];
    const balls=Array.from({length:7},(_,i)=>`dragon_ball_${i+1}`);
    const dollQty=itemQuantity(state,'server_13407');
    const activeName=run?.bossType==='champa'?'Champa':'Daishinkan';
    const rewardGrid=(ticketChance,ballChance,senzuMin,senzuMax,xp)=>`<div class="guild-boss-rewards"><h4>Recompensas por sobrevivente</h4><div class="guild-boss-reward-grid"><article><div>${tickets.map(id=>marketItemCard(id,'rare')).join('')}</div><b>Tickets de Boss</b><small>${ticketChance}% de chance base para cada ticket${lootBonus?` · Bênção do Abate +${lootBonus}% no loot-base`:''}</small></article><article><div>${balls.map(id=>marketItemCard(id,'common')).join('')}</div><b>Esferas do Dragão</b><small>${ballChance}% de chance fixa individual para cada esfera</small></article><article><div>${marketItemCard('server_2157','common')}</div><b>Mystic Senzu</b><small>${senzuMin} a ${senzuMax} unidades garantidas</small></article><article><span class="guild-boss-xp-icon">XP</span><b>Experiência elevada</b><small>${guildNumber(xp)} XP base</small></article></div></div>`;
    return `<section class="guild-panel guild-boss-panel"><header><div><h3>Bosses da Guild</h3><p>Escolha entre o desafio máximo do Daishinkan e a invocação por Champa Doll.</p></div><div class="guild-boss-vault">${ppIconHtml('inline')} <b>${guildNumber(g.ppVault)} PP</b> · Champa Doll <b>${guildNumber(dollQty)}</b></div></header>
      ${run?`<div class="guild-boss-active"><b>${run.status==='pending'?`${activeName} em preparação`:`${activeName} em andamento`}</b><span>${run.status==='pending'?`Inicia em aproximadamente ${seconds}s`:`${activeName} já está em combate.`}</span><small>${run.acceptedCount||0} membro(s) aceitaram até agora.</small></div>`:''}
      <div class="guild-boss-choice-grid">
        <article class="guild-boss-choice daishinkan">
          <div class="guild-boss-hero"><div class="guild-boss-portrait"><img src="./assets/generated/exact-transformations/portraits/758.png" alt="Daishinkan"></div><div><small>DESAFIO SUPREMO</small><h2>Daishinkan</h2><p>75.000.000 HP · 60.000.000 XP base · maior dificuldade e melhores recompensas.</p><p class="guild-boss-extra-loot">Drops extras: Majora Amulet e Blue Potara Ring.</p><div class="guild-boss-danger"><b>⚠ 100 PP DO COFRE</b><span>Somente Líder/Vice. Os PP são queimados sem gerar XP. Após a invocação, todos têm 1 minuto para aceitar.</span></div></div></div>
          ${rewardGrid(20,5,10,100,60000000)}
          <div class="guild-boss-summon"><div><b>Custo: 100 PP do Cofre</b><small>Se todos morrerem, os PP e a tentativa são perdidos.</small></div><button data-guild-boss-summon="daishinkan" ${run||!officer||g.ppVault<100||guildLoading?'disabled':''}>Invocar Daishinkan · 100 PP</button></div>
        </article>
        <article class="guild-boss-choice champa">
          <div class="guild-boss-hero"><div class="guild-boss-portrait"><img src="./assets/generated/vip-portraits/vip-champa-683.png" alt="Champa"></div><div><small>INVOCAÇÃO POR ITEM</small><h2>Champa</h2><p>18.000.000 HP · 18.000.000 XP base · bem mais fraco que o Daishinkan.</p><div class="guild-boss-danger mild"><b>1 CHAMPA DOLL</b><span>Qualquer Membro, Vice ou Líder pode invocar. Recrutas não podem. A Doll é consumida do inventário do invocador e a luta começa após 1 minuto.</span></div></div></div>
          ${rewardGrid(5,1,5,50,18000000)}
          <div class="guild-boss-summon"><div><b>Custo: 1 Champa Doll do jogador</b><small>Você possui ${guildNumber(dollQty)}. Se todos morrerem, a Doll e a tentativa são perdidas.</small></div><button data-guild-boss-summon="champa" ${run||!canChampa||dollQty<1||guildLoading?'disabled':''}>Invocar Champa · 1 Doll</button></div>
          ${!canChampa?'<p class="guild-permission-note">Recrutas não podem invocar o Champa. Seja promovido a Membro para usar a Champa Doll.</p>':''}
        </article>
      </div>
    </section>`;
  }
  function renderGuildHistory(){
    return `<section class="guild-panel"><header><h3>Histórico</h3><span>Últimas 100 ações</span></header><div class="guild-history-list">${(guildData.history||[]).map(row=>{const d=row.details||{};let text={
      'guild-created':`Guild criada${d.creationCostPp?` por ${d.creationCostPp} PP`:''}`,
      'join-requested':'Solicitou entrada na Guild','join-approved':`Aprovou ${escapeHtml(d.name||'jogador')} como Recruta`,'join-denied':`Recusou ${escapeHtml(d.name||'jogador')}`,
      'member-left':'Saiu da Guild','member-kicked':`Removeu ${escapeHtml(d.name||'membro')}`,'role-changed':`${escapeHtml(d.name||'Membro')}: ${guildRoleLabel(d.fromRole)} → ${guildRoleLabel(d.toRole)}`,
      'pp-deposited':`Depositou ${guildNumber(d.amount)} PP no Cofre`,'pp-converted':`Queimou ${guildNumber(d.amount)} PP → +${guildNumber(d.guildXp)} XP`,
      'guild-boss-summoned':d.bossType==='champa'?'Invocou Champa: 1 Champa Doll consumida':'Invocou Daishinkan: 100 PP queimados','guild-boss-won':`${d.bossType==='champa'?'Champa':'Daishinkan'} derrotado`,'guild-boss-lost':`${d.bossType==='champa'?'Champa':'Daishinkan'} perdido`,
      'settings-updated':'Configurações atualizadas'
    }[row.event];if(row.event==='donation')text=`Gold doado: ${guildNumber(d.amount)} · +${guildNumber(d.guildXp)} XP`;if(row.event==='technology-upgraded')text=`${escapeHtml(d.technologyName||guildTechUi[d.technologyId]?.name||d.technologyId||'Tecnologia')} → Nv ${d.level}`;return `<article><span>${new Date(row.created_at).toLocaleString('pt-BR')}</span><strong>${escapeHtml(row.character_name||'Sistema')}</strong><p>${text||escapeHtml(row.event||'Ação')}</p></article>`}).join('')||'<p class="guild-empty">Sem eventos ainda.</p>'}</div></section>`;
  }
  function renderGuildSettings(){const leader=guildData.role==='leader',g=guildData.guild;return `<section class="guild-panel guild-settings"><header><div><h3>Configurações</h3><p>${leader?'Gerencie a identidade e o recrutamento da Guild.':'Somente o Líder pode alterar estas opções.'}</p></div></header>${leader?`<form data-guild-settings><label>Mensagem do dia<textarea name="messageOfDay" maxlength="180">${escapeHtml(g.messageOfDay||'')}</textarea></label><label class="guild-check"><input type="checkbox" name="joinOpen" ${g.joinOpen?'checked':''}> Aceitar novas solicitações de entrada</label><button>Salvar configurações</button></form>`:''}<div class="guild-danger-zone"><b>${leader?'Encerrar Guild / Sair':'Sair da Guild'}</b><p>${leader?'O líder só pode encerrar a Guild quando for o único membro.':'Você perde os benefícios imediatamente, mas o histórico de contribuição permanece na Guild.'}</p><button class="danger" data-guild-leave>${leader?'Encerrar / Sair':'Sair da Guild'}</button></div></section>`;}
  function renderGuildContent(){
    if(!guildData?.guild)return renderGuildLobby();
    if(guildTab==='members')return renderGuildMembers();
    if(guildTab==='contributions')return renderGuildContributions();
    if(guildTab==='vault')return renderGuildVault();
    if(guildTab==='technologies')return renderGuildTechnologies();
    if(guildTab==='buffs')return renderGuildBuffs();
    if(guildTab==='boss')return renderGuildBoss();
    if(guildTab==='boss-bestiary')return renderGuildBossBestiary();
    if(guildTab==='ranking')return `<section class="guild-panel"><header><div><h3>Ranking de Guilds</h3><p>Compare progressão geral ou conquistas dos Bosses da Guild.</p></div><button data-guild-refresh>Atualizar</button></header><nav class="guild-ranking-subtabs"><button data-guild-ranking-subtab="level" class="${guildRankingSubTab==='level'?'active':''}">Nível</button><button data-guild-ranking-subtab="bosses" class="${guildRankingSubTab==='bosses'?'active':''}">Bosses</button></nav>${guildRankingTable(guildData.ranking||[],false,guildRankingSubTab)}</section>`;
    if(guildTab==='history')return renderGuildHistory();
    if(guildTab==='settings')return renderGuildSettings();
    return renderGuildOverview();
  }

  function renderGuild(){
    const g=guildData?.guild;const tabs=[['overview','Visão Geral'],['members','Membros'],['contributions','Contribuições'],['vault','Cofre'],['technologies','Tecnologias'],['buffs','Buffs'],['boss','Boss'],['boss-bestiary','Bestiário Bosses'],['ranking','Ranking'],['history','Histórico'],['settings','Configurações']];
    return `<div class="ui-overlay-backdrop guild-overlay"><section class="guild-window"><header class="guild-header"><div class="guild-emblem"><img src="./assets/ui/v2180/guild.png" alt="Guild"></div><div><h2>${g?`${escapeHtml(g.name)} <span>[${escapeHtml(g.tag)}]</span>`:'GUILD'}</h2><p>${g?`Nível ${g.level} · ${g.membersCount}/${g.benefits.memberLimit} membros · ${guildRoleLabel(guildData.role)}`:'Crie ou solicite entrada em uma guild para desbloquear benefícios coletivos.'}</p></div><button data-action="close-guild">×</button></header>${g?`<nav class="guild-tabs">${tabs.map(([id,label])=>`<button data-guild-tab="${id}" class="${guildTab===id?'active':''}">${label}${id==='members'&&guildOfficer()&&guildData.applications?.length?` <b>${guildData.applications.length}</b>`:''}</button>`).join('')}</nav>`:''}${guildMessage?`<div class="guild-message">${escapeHtml(guildMessage)}</div>`:''}<main class="guild-content">${guildLoading&&!guildData?'<div class="guild-loading">Carregando Guild...</div>':renderGuildContent()}</main></section></div>`;
  }

  function localRankingData(){
    const own={position:1,characterId:String(state.profile.id||'local'),name:state.profile.name||'Jogador',level:Number(state.profile.level||1)};
    const skills=Object.fromEntries(Object.keys(skillDefinitions).map(skillId=>[
      skillId,[{...own,value:Number(state.skills?.[skillId]?.level||1)}]
    ]));
    return {
      level:[{...own,value:Number(state.profile.level||1)}],
      bestiary:[{...own,value:bestiaryEarnedPoints(state)}],
      bossBestiary:[{...own,value:bossBestiaryEarnedPoints(state)}],
      skills
    };
  }

  async function loadRankingData(force=false){
    if(rankingLoading||!rankingOpen||(!force&&rankingData))return;
    rankingLoading=true;rankingMessage='';render();
    try{
      if(!socket.connected){rankingData=localRankingData();rankingMessage='Sem conexão: exibindo apenas o personagem atual.';return;}
      const result=await marketApi('/api/rankings?limit=100');
      rankingData={level:result.level||[],bestiary:result.bestiary||[],bossBestiary:result.bossBestiary||[],skills:result.skills||{}};
    }catch(error){
      rankingData=localRankingData();rankingMessage=`${error.message} · exibindo ranking local.`;
    }finally{
      rankingLoading=false;
      if(rankingOpen)render();
    }
  }

  function renderRanking(){
    const tabs=[['level','Level'],['bestiary','Bestiário'],['bossBestiary','Bestiário Boss'],...Object.entries(skillDefinitions).map(([id,def])=>[id,def.name])];
    const rows=rankingTab==='level'?(rankingData?.level||[]):rankingTab==='bestiary'?(rankingData?.bestiary||[]):rankingTab==='bossBestiary'?(rankingData?.bossBestiary||[]):((rankingData?.skills||{})[rankingTab]||[]);
    const valueLabel=rankingTab==='level'?'Level':rankingTab==='bestiary'?'Pontos Bestiário':rankingTab==='bossBestiary'?'Pontos Boss':(skillDefinitions[rankingTab]?.name||rankingTab);
    return `<div class="ui-overlay-backdrop ranking-overlay"><section class="ranking-window">
      <header><div><span>🏆</span><div><h2>RANKINGS</h2><p>Level, Bestiário, Bestiário de Bosses e ranking individual de cada skill.</p></div></div><div class="ranking-header-actions"><button data-ranking-refresh title="Atualizar">↻</button><button data-action="close-ranking">×</button></div></header>
      <nav class="ranking-tabs">${tabs.map(([id,label])=>`<button data-ranking-tab="${id}" class="${rankingTab===id?'active':''}">${escapeHtml(label)}</button>`).join('')}</nav>
      ${rankingMessage?`<p class="ranking-message">${escapeHtml(rankingMessage)}</p>`:''}
      <div class="ranking-table"><div class="ranking-row ranking-head"><b>#</b><b>Jogador</b><b>${escapeHtml(valueLabel)}</b><b>Level</b></div>${rankingLoading&&!rows.length?'<p class="ranking-loading">Carregando ranking...</p>':rows.map(row=>`<div class="ranking-row"><b>${Number(row.position||0)}</b><span>${escapeHtml(row.name||'Jogador')}</span><strong>${Number(row.value||0).toLocaleString('pt-BR')}</strong><small>${Number(row.level||1).toLocaleString('pt-BR')}</small></div>`).join('')||'<p class="ranking-loading">Nenhum personagem encontrado.</p>'}</div>
    </section></div>`;
  }

  function pvpWagerLabel(wager={}){
    const currency=String(wager.currency||'none'),amount=Math.max(0,Number(wager.amount)||0);
    if(currency==='none'||amount<=0)return 'Sem aposta';
    return `${amount.toLocaleString('pt-BR')} ${currency==='premium'?'PP':'Zeni'} de cada jogador`;
  }
  function pvpWagerPayload(){
    const currency=['zeni','premium'].includes(pvpWagerCurrency)?pvpWagerCurrency:'none';
    const amount=currency==='none'?0:Math.max(0,Math.trunc(Number(pvpWagerAmount)||0));
    return {wagerCurrency:currency,wagerAmount:amount};
  }
  function renderPvpInvite(){
    const invite=pvpInvite||{},wager=invite.wager||{currency:'none',amount:0,pot:0};
    const ownBalance=wager.currency==='premium'?Number(state.profile.premiumPoints??state.profile.vipCredits??0):Number(state.profile.bank||0);
    const lacks=Number(wager.amount||0)>0&&ownBalance<Number(wager.amount||0);
    return `<div class="pvp-invite-backdrop"><section class="pvp-invite-card" role="dialog" aria-modal="true">
      <span class="pvp-kicker">⚔ ARENA PvP</span>
      <h2>${escapeHtml(invite.fromName||'Jogador')} desafiou você</h2>
      <p>Duelo 1x1 com movimento, spells e cura manuais. O ataque básico fica automático somente após selecionar um target.</p>
      <div class="pvp-invite-wager ${Number(wager.amount||0)>0?'active':''}"><span>APOSTA</span><strong>${escapeHtml(pvpWagerLabel(wager))}</strong>${Number(wager.amount||0)>0?`<small>Prêmio total: ${Number(wager.pot||Number(wager.amount||0)*2).toLocaleString('pt-BR')} ${wager.currency==='premium'?'PP':'Zeni'}</small>`:'<small>Duelo amistoso sem moeda em risco.</small>'}</div>
      ${lacks?`<p class="pvp-wager-insufficient">Você não tem essa quantia para apostar.</p>`:''}
      <div><button class="subtle" data-pvp-decline>Recusar</button><button class="primary" data-pvp-accept>Aceitar duelo</button></div>
      <small>O servidor confirma os dois saldos antes de iniciar a luta.</small>
    </section></div>`;
  }

  function pvpOwnParticipant(){
    return pvpState?.players?.find(player=>String(player.id)===String(pvpState.ownId||state.profile.id||''))||null;
  }

  function pvpCooldownRemaining(spellId,now=Date.now()){
    const own=pvpOwnParticipant();
    return Math.max(0,Number(own?.cooldowns?.[spellId]||0)-now);
  }

  function pvpBasicAttackRemaining(now=Date.now()){
    const own=pvpOwnParticipant();
    return Math.max(0,Number(own?.basicAttackReadyAt||0)-now);
  }

  function pvpTargetParticipant(){
    const own=pvpOwnParticipant();
    const targetId=String(own?.targetId||'');
    return pvpState?.players?.find(player=>String(player.id)===targetId)||null;
  }

  function pvpBasicAttackButton(){
    const remaining=pvpBasicAttackRemaining();
    const own=pvpOwnParticipant();
    const target=pvpTargetParticipant();
    const range=Math.max(1,Number(own?.basicAttackRange||1));
    return `<div class="pvp-spell-slot pvp-basic-attack ${remaining>0?'on-cooldown':''} ${target?'has-target':'no-target'}" title="Ataque básico automático após selecionar um target. Alcance atual: ${range} SQM.">
      <span class="pvp-basic-icon">⚔</span>
      <span class="pvp-spell-name">ATK AUTO</span>
      <small>${target?`${escapeHtml(target.name)} · ${range} SQM`:`Target necessário · ${range} SQM`}</small>
      <span class="pvp-spell-cooldown" data-pvp-basic-cooldown ${remaining>0?'':'hidden'}>${remaining>0?`${(remaining/1000).toFixed(1)}s`:''}</span>
    </div>`;
  }

  function pvpSpellButton(spell,label=''){
    if(!spell)return `<div class="pvp-spell-slot empty"><span>${escapeHtml(label||'—')}</span></div>`;
    const remaining=pvpCooldownRemaining(spell.id);
    return `<button class="pvp-spell-slot ${remaining>0?'on-cooldown':''}" data-pvp-cast-spell="${escapeHtml(spell.id)}" title="${escapeHtml(spell.name)} · ${spellKiCostLabel(spell)}">
      <img src="${escapeHtml(spell.icon||'')}" alt="${escapeHtml(spell.name)}">
      <span class="pvp-spell-name">${escapeHtml(spell.name)}</span>
      <span class="pvp-spell-cooldown" data-pvp-spell-cooldown="${escapeHtml(spell.id)}" ${remaining>0?'':'hidden'}>${remaining>0?`${(remaining/1000).toFixed(1)}s`:''}</span>
    </button>`;
  }

  // Constantes do palco 3D do PvP. PVP_FAR é a largura da borda do fundo em
  // relação à da frente; PVP_TOP é quanto do topo da arena fica reservado
  // para o fundo (acima do horizonte). O mesmo par é usado no CSS
  // (.pvp-arena) e na conversão do clique — mexer aqui exige mexer lá.
  const PVP_FAR=0.58;
  const PVP_TOP=22;

  function renderPvp() {
    if(!pvpState){
      const available=presence.filter(player=>(!player.activity||player.activity==='world'));
      const blocked=Boolean(partyState||tradeState);
      return `<div class="pvp-page pvp-lobby">
        <section class="pvp-lobby-hero"><span class="pvp-kicker">⚔ COMBATE MANUAL</span><h1>Arena PvP 1x1</h1>
          <p>Desafie outro jogador. Você precisa <b>andar manualmente</b>, <b>clicar nas spells</b> e <b>clicar na cura</b>. O <b>ataque básico é automático</b> somente enquanto houver um target válido no alcance.</p>
          <div class="pvp-rules"><span>✓ Auto-attack por target</span><span>✓ Sem auto-heal</span><span>✓ Sem loot/XP</span><span>✓ Sem penalidade de morte</span></div>
        </section>
        ${pvpMessage?`<div class="pvp-message">${escapeHtml(pvpMessage)}</div>`:''}
        ${pvpLastResult?`<div class="pvp-result ${pvpLastResult.won===true?'win':pvpLastResult.won===false?'loss':''}"><strong>${pvpLastResult.won===true?'Vitória!':pvpLastResult.won===false?'Derrota':'Duelo encerrado'}</strong><span>${escapeHtml(pvpLastResult.reason||'')}</span></div>`:''}
        ${blocked?`<div class="pvp-warning">Finalize ${tradeState?'o Trade':'a Party'} antes de iniciar um duelo PvP.</div>`:''}
        <section class="pvp-wager-config"><header><div><span>💰</span><div><strong>Aposta do duelo</strong><small>Os dois jogadores colocam exatamente o mesmo valor.</small></div></div><em>Opcional</em></header><div class="pvp-wager-options"><button data-pvp-wager-currency="none" class="${pvpWagerCurrency==='none'?'active':''}">Sem aposta</button><button data-pvp-wager-currency="zeni" class="${pvpWagerCurrency==='zeni'?'active':''}">Zeni</button><button data-pvp-wager-currency="premium" class="${pvpWagerCurrency==='premium'?'active':''}">PP</button></div>${pvpWagerCurrency!=='none'?`<label>Valor por jogador<input data-pvp-wager-amount type="number" min="1" step="1" value="${Math.max(1,Number(pvpWagerAmount)||1)}"><small>Seu saldo: ${(pvpWagerCurrency==='premium'?Number(state.profile.premiumPoints??state.profile.vipCredits??0):Number(state.profile.bank||0)).toLocaleString('pt-BR')} ${pvpWagerCurrency==='premium'?'PP':'Zeni'} · prêmio: ${(Math.max(1,Number(pvpWagerAmount)||1)*2).toLocaleString('pt-BR')} ${pvpWagerCurrency==='premium'?'PP':'Zeni'}</small></label>`:'<p>Nenhuma moeda será transferida neste duelo.</p>'}</section>
        <section class="pvp-online-list"><header><div><strong>Jogadores disponíveis no PZ</strong><small>${available.length} disponível(is)</small></div><button data-pvp-refresh>Atualizar</button></header>
          <div class="pvp-player-grid">${available.length?available.map(player=>`<article class="pvp-player-card">
            <img src="${escapeHtml(player.sprite||'./assets/generated/outfits/goku.webp')}" alt=""><div><strong>${escapeHtml(player.name||'Jogador')}</strong><span>Level ${Number(player.level||1).toLocaleString('pt-BR')}</span></div>
            <button data-pvp-challenge="${escapeHtml(player.profileId||'')}" ${blocked?'disabled':''}>Desafiar</button>
          </article>`).join(''):'<p class="pvp-empty">Nenhum outro jogador disponível no PZ agora.</p>'}</div>
        </section>
        <button class="pvp-back-pz" data-view="world">← Voltar ao PZ</button>
      </div>`;
    }

    const own=pvpOwnParticipant();
    const enemy=pvpState.players?.find(player=>String(player.id)!==String(pvpState.ownId));
    if(!own||!enemy)return `<div class="pvp-page"><p>Sincronizando duelo...</p></div>`;
    const width=Math.max(2,Number(pvpState.width||24)),height=Math.max(2,Number(pvpState.height||14));
    // V22.1 — palco 3D do PvP.
    // A arena continua sendo um retângulo de divs, mas a posição de cada
    // lutador passa pela mesma projeção hiperbólica (1/z) da arena de Hunt:
    // quem está no fundo fica mais ao centro e menor, quem está na frente
    // fica mais largo e maior. O CSS só consome left/top/--pvp-depth.
    // A conversão inversa (clique -> tile) está no handler de [data-pvp-arena]
    // e usa exatamente estas mesmas constantes.
    const positionStyle=player=>{
      const t=Math.max(0,Math.min(1,Number(player.y||0)/(height-1)));
      const scale=PVP_FAR/(1-t*(1-PVP_FAR));
      const row=(scale-PVP_FAR)/(1-PVP_FAR);
      const left=50+(((Number(player.x||0)/(width-1))-0.5)*100*scale);
      const top=PVP_TOP+row*(100-PVP_TOP);
      const depth=scale*(2/(1+PVP_FAR));
      return `left:${left.toFixed(3)}%;top:${top.toFixed(3)}%;`
        +`--pvp-depth:${depth.toFixed(3)};z-index:${3+Math.round(row*10)}`;
    };
    const hpPct=player=>Math.max(0,Math.min(100,(Number(player.hp||0)/Math.max(1,Number(player.maxHp||1)))*100));
    const kiPct=player=>Math.max(0,Math.min(100,(Number(player.ki||0)/Math.max(1,Number(player.maxKi||1)))*100));
    const countdown=Math.max(0,Math.ceil((Number(pvpState.startsAt||0)-Date.now())/1000));
    const attacks=(state.settings.spellBar?.slots||[]).slice(0,4).map(id=>allSpellsForCategory('attack').find(spell=>spell.id===id&&spellUnlocked(spell))||null);
    const supports=['buff','speed','healing'].map(kind=>supportSpell(kind)||spellsForCategory(kind).at(-1)||null);
    return `<div class="pvp-page pvp-battle">
      <header class="pvp-battle-header">
        <div class="pvp-fighter-status own"><strong>${escapeHtml(own.name)}</strong><span>Lv ${Number(own.level||1)}</span><div class="pvp-bar hp"><i style="width:${hpPct(own)}%"></i><b>${Math.round(own.hp).toLocaleString('pt-BR')} / ${Math.round(own.maxHp).toLocaleString('pt-BR')}</b></div><div class="pvp-bar ki"><i style="width:${kiPct(own)}%"></i><b>${Math.round(own.ki).toLocaleString('pt-BR')} / ${Math.round(own.maxKi).toLocaleString('pt-BR')}</b></div></div>
        <div class="pvp-versus"><span>1 x 1</span><strong>VS</strong></div>
        <div class="pvp-fighter-status enemy"><strong>${escapeHtml(enemy.name)}</strong><span>Lv ${Number(enemy.level||1)}</span><div class="pvp-bar hp"><i style="width:${hpPct(enemy)}%"></i><b>${Math.round(enemy.hp).toLocaleString('pt-BR')} / ${Math.round(enemy.maxHp).toLocaleString('pt-BR')}</b></div><div class="pvp-bar ki"><i style="width:${kiPct(enemy)}%"></i><b>${Math.round(enemy.ki).toLocaleString('pt-BR')} / ${Math.round(enemy.maxKi).toLocaleString('pt-BR')}</b></div></div>
      </header>
      <div class="pvp-battle-wager ${Number(pvpState.wager?.amount||0)>0?'active':''}"><span>APOSTA</span><strong>${escapeHtml(pvpWagerLabel(pvpState.wager||{}))}</strong>${Number(pvpState.wager?.amount||0)>0?`<em>Prêmio ${Number(pvpState.wager?.pot||Number(pvpState.wager?.amount||0)*2).toLocaleString('pt-BR')} ${pvpState.wager?.currency==='premium'?'PP':'Zeni'}</em>`:''}</div>
      <div class="pvp-arena" data-pvp-arena data-pvp-width="${width}" data-pvp-height="${height}">
        <div class="pvp-grid-lines"></div>
        ${countdown>0?`<div class="pvp-countdown"><span>PREPARE-SE</span><strong data-pvp-countdown>${countdown}</strong></div>`:''}
        <div class="pvp-actor own" style="${positionStyle(own)}"><span>${escapeHtml(own.name)}</span><img src="${escapeHtml(own.sprite||'./assets/generated/outfits/goku.webp')}" alt=""></div>
        <div class="pvp-actor enemy ${String(own.targetId||'')===String(enemy.id)?'targeted':''}" data-pvp-target-id="${escapeHtml(enemy.id)}" style="${positionStyle(enemy)}"><span>${escapeHtml(enemy.name)}</span><img src="${escapeHtml(enemy.sprite||'./assets/generated/outfits/goku.webp')}" alt=""><b class="pvp-target-label">TARGET</b></div>
      </div>
      <div class="pvp-target-status ${pvpTargetParticipant()?'active':''}"><span>🎯 Target:</span><strong>${escapeHtml(pvpTargetParticipant()?.name||'Nenhum')}</strong><small>Clique com o botão direito no inimigo para selecionar.</small></div>
      <div class="pvp-manual-help"><b>Controle:</b> botão direito no inimigo = target e ativa o ataque básico automático · WASD/setas ou clique na arena = andar · spells ofensivas usam o target escolhido · cura/buffs continuam manuais.</div>
      ${pvpMessage?`<div class="pvp-message compact">${escapeHtml(pvpMessage)}</div>`:''}
      <div class="pvp-hotbar"><section><label>TARGET / ATAQUE BÁSICO AUTO + SPELLS MANUAIS</label><div class="pvp-attack-actions">${pvpBasicAttackButton()}${attacks.map((spell,index)=>pvpSpellButton(spell,String(index+1))).join('')}</div></section><section><label>SUPORTE / CURA MANUAL</label><div>${supports.map((spell,index)=>pvpSpellButton(spell,['BUFF','SPEED','CURA'][index])).join('')}</div></section></div>
      <button class="pvp-forfeit" data-pvp-forfeit>Abandonar duelo</button>
    </div>`;
  }

  let transformationInProgress=false;

  function transformCurrentCharacter() {
    if(transformationInProgress){
      return {ok:false,message:'Transformação em andamento.'};
    }
    transformationInProgress=true;

    const char=characters[state.profile.characterId];
    // V22.4: a forma ANTIGA e capturada antes da troca de estado para que a
    // cinematica de transformacao possa segurar o sprite antigo durante a
    // fase de carga e so trocar no estouro.
    const previousForm=currentTransformationForm(state,char);
    const result=applyNextTransformation(
      state,
      char,
      standardTransformationTransitions
    );

    log(result.message);
    if(!result.ok){
      transformationInProgress=false;
      return result;
    }

    state.characterDefinition=char;
    // V22.4: cinematica (carga -> estouro -> aura) na arena da Hunt.
    try{
      huntRenderer?.playTransformation?.({
        previousOutfitId:previousForm?.outfitId||char?.outfitId||null,
        outfitId:result.form?.outfitId||char?.outfitId||null,
        label:result.form?.name||''
      });
    }catch(error){
      console.warn('Cinematica de transformacao indisponivel:',error);
    }
    socket?.sendGameAction('transform');
    persist();
    syncMultiplayerAppearance();

    requestAnimationFrame(()=>{
      transformationInProgress=false;
      render();
    });
    return result;
  }

  function bindTransformButton() {
    root.querySelectorAll('[data-action="transform-character"]')
      .forEach(button => {
        if (button.dataset.transformBound === '1') return;
        button.dataset.transformBound = '1';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          transformCurrentCharacter();
        });
      });
  }

  function bindContainerWindowDrag() {
    root.querySelectorAll('.container-window-backdrop').forEach(backdrop => {
      const handle = backdrop.querySelector('[data-container-drag-handle]');
      if (!handle) return;

      const kind = backdrop.dataset.containerWindowKind || 'backpack';
      const positionKey = backdrop.dataset.containerPositionKey || kind;
      const clampPosition = (x, y) => {
        const rect = backdrop.getBoundingClientRect();
        const maxX = Math.max(0, window.innerWidth - rect.width);
        const maxY = Math.max(0, window.innerHeight - rect.height);
        return {
          x:Math.max(0, Math.min(maxX, Number(x) || 0)),
          y:Math.max(0, Math.min(maxY, Number(y) || 0))
        };
      };

      const saved = state.settings?.containerWindowPositions?.[positionKey] || state.settings?.containerWindowPositions?.[kind];
      if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
        const next = clampPosition(saved.x, saved.y);
        backdrop.style.setProperty('left', `${next.x}px`, 'important');
        backdrop.style.setProperty('top', `${next.y}px`, 'important');
        backdrop.style.setProperty('right', 'auto', 'important');
        backdrop.style.setProperty('bottom', 'auto', 'important');
      }

      let drag = null;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        const rect = backdrop.getBoundingClientRect();
        drag = {
          pointerId:event.pointerId,
          offsetX:event.clientX - rect.left,
          offsetY:event.clientY - rect.top
        };
        backdrop.style.setProperty('left', `${rect.left}px`, 'important');
        backdrop.style.setProperty('top', `${rect.top}px`, 'important');
        backdrop.style.setProperty('right', 'auto', 'important');
        backdrop.style.setProperty('bottom', 'auto', 'important');
        backdrop.style.zIndex = '123';
        handle.setPointerCapture?.(event.pointerId);
        handle.classList.add('dragging');
        event.preventDefault();
      });

      handle.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const next = clampPosition(
          event.clientX - drag.offsetX,
          event.clientY - drag.offsetY
        );
        backdrop.style.setProperty('left', `${next.x}px`, 'important');
        backdrop.style.setProperty('top', `${next.y}px`, 'important');
      });

      const finishDrag = event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const rect = backdrop.getBoundingClientRect();
        const next = clampPosition(rect.left, rect.top);
        state.settings.containerWindowPositions ||= {};
        state.settings.containerWindowPositions[positionKey] = next;
        persist();
        handle.classList.remove('dragging');
        backdrop.style.zIndex = '';
        if (handle.hasPointerCapture?.(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
        drag = null;
      };

      handle.addEventListener('pointerup', finishDrag);
      handle.addEventListener('pointercancel', finishDrag);
    });
  }

  function bindItemTooltipTargets(scope = root) {
    const tooltip = root.querySelector('#item-tooltip');
    if (!tooltip || !scope?.querySelectorAll) return;
    const positionTooltip = event => {
      if (!tooltip.classList.contains('visible')) return;
      const margin = 14;
      const rect = tooltip.getBoundingClientRect();
      let left = event.clientX + 18;
      let top = event.clientY + 18;
      if (left + rect.width + margin > window.innerWidth) left = event.clientX - rect.width - 18;
      if (top + rect.height + margin > window.innerHeight) top = window.innerHeight - rect.height - margin;
      tooltip.style.left = `${Math.max(margin,left)}px`;
      tooltip.style.top = `${Math.max(margin,top)}px`;
    };
    scope.querySelectorAll('[data-tooltip-item]').forEach(element => {
      if (element.dataset.tooltipBound === '1') return;
      element.dataset.tooltipBound = '1';
      element.addEventListener('mouseenter', event => {
        const baseItem = itemCatalog[element.dataset.tooltipItem];
        const item = rarityAdjustedItem(baseItem,{rarity:element.dataset.tooltipRarity||'common'});
        if (!item) return;
        tooltip.innerHTML = itemTooltipHtml(item,element.dataset.tooltipSlot || '');
        tooltip.classList.add('visible');
        positionTooltip(event);
      });
      element.addEventListener('mousemove', positionTooltip);
      element.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
      element.addEventListener('dragstart', () => tooltip.classList.remove('visible'));
    });
  }

  function bindEvents() {
    root.querySelectorAll('[data-offline-return-tab]').forEach(button=>button.addEventListener('click',()=>{
      offlineReturnTab=button.dataset.offlineReturnTab==='loot'?'loot':'summary';render();
    }));
    root.querySelector('[data-offline-return-disable]')?.addEventListener('click',event=>{
      event.currentTarget.disabled=true;
      event.currentTarget.textContent='Desativando...';
      const mode=state.hunt?.offlineMode||{};
      mode.active=false;mode.awaitingReturn=false;mode.settled=true;
      activeView='world';huntChooserOpen=false;offlineReturnTab='summary';
      render();
      socket.sendGameAction('offline-stop');
    });
    const stackRange=root.querySelector('[data-stack-quantity-range]');
    stackRange?.addEventListener('input',()=>{
      if(!stackMoveDialog)return;
      stackMoveDialog.quantity=Math.max(1,Math.min(Number(stackMoveDialog.max||1),Number(stackRange.value||1)));
      const label=root.querySelector('[data-stack-quantity-value]');if(label)label.textContent=String(stackMoveDialog.quantity);
    });
    root.querySelector('[data-stack-quantity-cancel]')?.addEventListener('click',()=>{stackMoveDialog=null;render();});
    root.querySelector('[data-stack-quantity-confirm]')?.addEventListener('click',()=>{
      if(!stackMoveDialog)return;
      const pending=stackMoveDialog;stackMoveDialog=null;
      // O modal precisa desaparecer antes de operações assíncronas de chão
      // ou websocket; caso contrário ele ficava preso até o próximo snapshot.
      render();
      executeStackMove(pending.data,pending.operation,Number(pending.quantity||pending.max||1));
    });
    root.querySelector('[data-action="open-market"]')?.addEventListener('click',()=>{if(!marketAvailable())return;marketOpen=true;loadMarketData();render();});
    root.querySelector('[data-action="close-market"]')?.addEventListener('click',()=>{marketOpen=false;marketDialog=null;render();});
    root.querySelector('[data-action="open-vip"]')?.addEventListener('click',()=>{vipStoreOpen=true;render();});
    root.querySelector('[data-action="open-daily"]')?.addEventListener('click',()=>{dailyGiftOpen=true;render();});
    root.querySelector('[data-action="close-daily"]')?.addEventListener('click',()=>{dailyGiftOpen=false;render();});
    root.querySelector('[data-action="open-game-pass"]')?.addEventListener('click',()=>{gamePassOpen=true;render();});
    root.querySelector('[data-action="open-mail"]')?.addEventListener('click',()=>{mailOpen=true;render();});
    root.querySelector('[data-action="close-mail"]')?.addEventListener('click',()=>{mailOpen=false;render();});
    root.querySelectorAll('[data-mail-claim]').forEach(button=>button.addEventListener('click',()=>{const mailId=button.dataset.mailClaim;if(socket.connected)socket.sendGameAction('mail-claim',{mailId});else localClaimMail(mailId);}));
    root.querySelector('[data-action="close-game-pass"]')?.addEventListener('click',()=>{gamePassOpen=false;render();});
    root.querySelectorAll('[data-game-pass-tab]').forEach(button=>button.addEventListener('click',()=>{gamePassTab=button.dataset.gamePassTab==='missions'?'missions':'rewards';render();}));
    root.querySelector('[data-pass-buy-level]')?.addEventListener('click',()=>vipMutate('/api/vip/game-pass-level',{characterId:state.profile.id}));
    root.querySelector('[data-action="open-bestiary"]')?.addEventListener('click',()=>{bestiaryOpen=true;render();});
    root.querySelector('[data-action="close-bestiary"]')?.addEventListener('click',()=>{bestiaryOpen=false;render();});
    root.querySelector('[data-action="open-ranking"]')?.addEventListener('click',()=>{rankingOpen=true;rankingData=null;render();loadRankingData(true);});
    root.querySelector('[data-action="close-ranking"]')?.addEventListener('click',()=>{rankingOpen=false;render();});
    root.querySelectorAll('[data-ranking-tab]').forEach(button=>button.addEventListener('click',()=>{rankingTab=button.dataset.rankingTab||'level';render();}));
    root.querySelector('[data-ranking-refresh]')?.addEventListener('click',()=>{rankingData=null;loadRankingData(true);});

    // V21.8.0 - Guild: Gold gera XP imediatamente; PP vai primeiro ao Cofre.
    // Entradas, cargos, pesquisas e Boss passam pela API autoritativa.
    root.querySelector('[data-action="open-guild"]')?.addEventListener('click',()=>{guildOpen=true;guildTab='overview';guildData=null;guildMessage='';render();loadGuildData(true);});
    root.querySelector('[data-action="close-guild"]')?.addEventListener('click',()=>{guildOpen=false;guildMessage='';render();});
    root.querySelectorAll('[data-guild-tab]').forEach(button=>button.addEventListener('click',()=>{guildTab=button.dataset.guildTab||'overview';render();}));
    root.querySelectorAll('[data-guild-ranking-subtab]').forEach(button=>button.addEventListener('click',()=>{guildRankingSubTab=button.dataset.guildRankingSubtab==='bosses'?'bosses':'level';render();}));
    root.querySelectorAll('[data-guild-boss-bestiary-upgrade]').forEach(button=>button.addEventListener('click',()=>guildMutate('/api/guild/boss-bestiary/upgrade',{key:button.dataset.guildBossBestiaryUpgrade})));
    root.querySelector('[data-guild-refresh]')?.addEventListener('click',()=>{guildData=null;loadGuildData(true);});
    root.querySelector('[data-guild-create]')?.addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form);guildMutate('/api/guild/create',{name:String(data.get('name')||'').trim(),tag:String(data.get('tag')||'').trim()});});
    root.querySelectorAll('[data-guild-join]').forEach(button=>button.addEventListener('click',()=>guildMutate('/api/guild/join',{guildId:button.dataset.guildJoin})));
    root.querySelectorAll('[data-guild-donate]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);const amount=Math.max(0,Math.trunc(Number(data.get('amount'))||0));guildMutate('/api/guild/donate',{currency:form.dataset.guildDonate==='premium'?'premium':'gold',amount});}));
    root.querySelectorAll('[data-guild-application]').forEach(button=>button.addEventListener('click',()=>guildMutate('/api/guild/application',{targetCharacterId:button.dataset.characterId,decision:button.dataset.guildApplication})));
    root.querySelectorAll('[data-guild-role]').forEach(select=>select.addEventListener('change',()=>guildMutate('/api/guild/role',{targetCharacterId:select.dataset.guildRole,role:select.value})));
    root.querySelector('[data-guild-convert-pp]')?.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);const amount=Math.max(0,Math.trunc(Number(data.get('amount'))||0));guildMutate('/api/guild/convert-pp',{amount});});
    root.querySelectorAll('[data-guild-tech]').forEach(button=>button.addEventListener('click',()=>guildMutate('/api/guild/technology',{technologyId:button.dataset.guildTech})));
    root.querySelectorAll('[data-guild-boss-summon]').forEach(button=>button.addEventListener('click',()=>{const bossType=button.dataset.guildBossSummon==='champa'?'champa':'daishinkan';const warning=bossType==='champa'?'Invocar o Champa vai CONSUMIR 1 Champa Doll do seu inventário. Todos os membros terão 1 minuto para aceitar. Se todos morrerem, a tentativa e a Doll serão perdidas. Deseja continuar?':'Invocar o Daishinkan vai QUEIMAR 100 PP do Cofre sem gerar XP. Todos os membros terão 1 minuto para aceitar. Se todos morrerem, a tentativa e os PP serão perdidos. Deseja continuar?';if(!window.confirm(warning))return;guildMutate('/api/guild/boss/summon',{bossType});}));
    root.querySelector('[data-guild-settings]')?.addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form);guildMutate('/api/guild/settings',{messageOfDay:String(data.get('messageOfDay')||''),joinOpen:Boolean(form.elements.joinOpen?.checked)});});
    root.querySelectorAll('[data-guild-kick]').forEach(button=>button.addEventListener('click',()=>{const name=button.closest('article')?.querySelector('strong')?.textContent||'este membro';if(!window.confirm(`Remover ${name} da Guild?`))return;guildMutate('/api/guild/kick',{targetCharacterId:button.dataset.guildKick});}));
    root.querySelector('[data-guild-leave]')?.addEventListener('click',()=>{const isLeader=guildData?.role==='leader';if(!window.confirm(isLeader?'Encerrar a Guild? Isso só será permitido se você for o único membro.':'Sair da Guild e perder os benefícios imediatamente?'))return;guildMutate('/api/guild/leave');});
    root.querySelector('[data-action="open-self-profile"]')?.addEventListener('click',()=>{
      characterProfileData=selfCharacterProfileData();
      characterProfileOpen=true;profileTab='profile';profileCosmeticPicker=null;
      playerContextTarget=null;
      tradeMessage='';
      render();
    });
    root.querySelectorAll('[data-player-context-close]').forEach(el=>el.addEventListener('click',()=>{playerContextTarget=null;tradeMessage='';render();}));
    root.querySelector('[data-player-profile]')?.addEventListener('click',event=>{
      const id=event.currentTarget.dataset.playerProfile;
      if(!socket.connected){tradeMessage='O perfil de outro jogador requer conexão com o servidor.';render();return;}
      socket.requestCharacterProfile(id);
    });
    root.querySelector('[data-player-trade]')?.addEventListener('click',event=>{
      const id=event.currentTarget.dataset.playerTrade;
      if(!socket.connected){tradeMessage='O Trade requer conexão com o servidor.';render();return;}
      socket.sendTradeAction('invite',{characterId:id});
    });
    root.querySelector('[data-player-pvp]')?.addEventListener('click',()=>{
      if(!socket.connected){pvpMessage='O PvP requer conexão com o servidor.';render();return;}
      if(activeView!=='world'){pvpMessage='Volte ao PZ antes de desafiar outro jogador.';render();return;}
      pvpMessage='Configure a aposta e escolha o jogador que deseja desafiar.';playerContextTarget=null;activeView='pvp';pvpLastResult=null;
      socket.sendPvpAction('status');render();
    });
    root.querySelector('[data-profile-close]')?.addEventListener('click',()=>{characterProfileOpen=false;characterProfileData=null;profileCosmeticPicker=null;render();});
    root.querySelectorAll('[data-profile-tab]').forEach(button=>button.addEventListener('click',()=>{profileTab=button.dataset.profileTab==='equipment'?'equipment':'profile';render();}));
    root.querySelectorAll('[data-profile-cosmetic-open]').forEach(button=>button.addEventListener('click',()=>{if(!characterProfileData?.isSelf)return;profileCosmeticPicker=button.dataset.profileCosmeticOpen==='border'?'border':'icon';render();}));
    root.querySelector('[data-profile-cosmetic-close]')?.addEventListener('click',()=>{profileCosmeticPicker=null;render();});
    root.querySelectorAll('[data-profile-cosmetic-select]').forEach(button=>button.addEventListener('click',()=>{
      if(!characterProfileData?.isSelf)return;
      const [kind,value]=String(button.dataset.profileCosmeticSelect||'').split('|');
      const list=kind==='border'?['default',...(state.profile.unlockedProfileBorders||[])]:['default',...(state.profile.unlockedProfileIcons||[])];
      if(!list.includes(value)){log('Este cosmético ainda não foi liberado na sua conta.');return;}
      if(kind==='border')state.profile.profileBorder=value;else state.profile.profileIcon=value;
      characterProfileData=selfCharacterProfileData();profileCosmeticPicker=null;
      if(socket.connected)socket.sendGameAction('profile-cosmetic',{kind,value});else persist();
      render();
    }));
    root.querySelector('[data-trade-decline]')?.addEventListener('click',()=>socket.sendTradeAction('decline'));
    root.querySelector('[data-trade-accept]')?.addEventListener('click',()=>socket.sendTradeAction('accept'));
    root.querySelectorAll('[data-trade-cancel]').forEach(el=>el.addEventListener('click',()=>socket.sendTradeAction('cancel')));
    root.querySelectorAll('[data-trade-add]').forEach(el=>el.addEventListener('click',()=>tradeOfferWithDelta(el.dataset.tradeAdd,1)));
    root.querySelectorAll('[data-trade-remove]').forEach(el=>el.addEventListener('click',()=>tradeOfferWithDelta(el.dataset.tradeRemove,-1)));
    root.querySelector('[data-trade-currency-apply]')?.addEventListener('click',()=>{
      if(!tradeState)return;
      const zeni=Math.max(0,Math.trunc(Number(root.querySelector('[data-trade-zeni]')?.value)||0));
      const pp=Math.max(0,Math.trunc(Number(root.querySelector('[data-trade-pp]')?.value)||0));
      socket.sendTradeAction('offer',{offer:{items:(tradeState.ownOffer?.items||[]).map(row=>({key:row.key,quantity:row.quantity})),zeni,pp}});
    });
    root.querySelector('[data-trade-confirm]')?.addEventListener('click',()=>socket.sendTradeAction('confirm'));
    root.querySelector('[data-action="open-forge"]')?.addEventListener('click',()=>{if(!forgeAvailable())return;forgeOpen=true;render();});
    root.querySelector('[data-action="close-forge"]')?.addEventListener('click',()=>{forgeOpen=false;render();});
    root.querySelectorAll('[data-forge-item]').forEach(button=>button.addEventListener('click',()=>{forgeSelectedInstanceId=button.dataset.forgeItem;render();}));
    root.querySelectorAll('[data-forge-attempts]').forEach(button=>button.addEventListener('click',()=>{forgeAttempts=Math.max(1,Number(button.dataset.forgeAttempts)||5);render();}));
    root.querySelector('[data-forge-roll]')?.addEventListener('click',()=>{if(!forgeSelectedInstanceId)return;if(socket.connected)socket.sendGameAction('forge-roll',{instanceId:forgeSelectedInstanceId,attempts:forgeAttempts});else localForgeRoll(forgeSelectedInstanceId,forgeAttempts);});
    root.querySelector('[data-forge-continue]')?.addEventListener('click',()=>{if(socket.connected)socket.sendGameAction('forge-continue',{});else localForgeContinue();});
    root.querySelector('[data-forge-accept]')?.addEventListener('click',()=>{if(socket.connected)socket.sendGameAction('forge-accept',{});else localForgeResolve(true);});
    root.querySelector('[data-forge-reject]')?.addEventListener('click',()=>{if(socket.connected)socket.sendGameAction('forge-reject',{});else localForgeResolve(false);});
    root.querySelector('[data-bestiary-search]')?.addEventListener('input',event=>{bestiarySearch=event.target.value;render();});
    root.querySelectorAll('[data-bestiary-tab]').forEach(button=>button.addEventListener('click',()=>{bestiaryTab=button.dataset.bestiaryTab==='bosses'?'bosses':'monsters';bestiarySearch='';render();}));
    root.querySelectorAll('[data-bestiary-upgrade]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.bestiaryUpgrade;
      if(socket.connected){socket.sendGameAction('bestiary-upgrade',{key});return;}
      const result=applyBestiaryUpgrade(state,key);
      if(result.ok){persist();render();}else log(result.message);
    }));
    root.querySelectorAll('[data-boss-bestiary-upgrade]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.bossBestiaryUpgrade;
      if(socket.connected){socket.sendGameAction('boss-bestiary-upgrade',{key});return;}
      const result=applyBossBestiaryUpgrade(state,key);
      if(result.ok){persist();render();}else log(result.message);
    }));
    root.querySelector('[data-vip-daily]')?.addEventListener('click',()=>vipMutate('/api/vip/daily-claim',{characterId:state.profile.id}));
    root.querySelectorAll('[data-pass-mission]').forEach(b=>b.addEventListener('click',()=>{
      if(socket.connected)socket.sendGameAction('game-pass-mission-claim',{missionId:b.dataset.passMission});
      else localClaimGamePassMission(b.dataset.passMission);
    }));
    root.querySelectorAll('[data-pass-claim]').forEach(b=>b.addEventListener('click',()=>{
      const [track,tier]=b.dataset.passClaim.split('|');
      if(socket.connected)socket.sendGameAction('game-pass-tier-claim',{track,tier:Number(tier)});
      else localClaimGamePassTier(track,Number(tier));
    }));
    root.querySelector('[data-action="open-party"]')?.addEventListener('click',()=>{partyPanelOpen=true;render();});
    root.querySelector('[data-action="open-friends"]')?.addEventListener('click',()=>{friendsPanelOpen=true;friendsMessage=null;render();});
    root.querySelector('[data-friends-close]')?.addEventListener('click',()=>{friendsPanelOpen=false;friendsMessage=null;render();});
    root.querySelector('[data-party-close]')?.addEventListener('click',()=>{partyPanelOpen=false;partyMessage='';render();});
    root.querySelector('[data-party-create]')?.addEventListener('click',()=>socket.sendPartyAction('create'));
    root.querySelector('[data-party-invite]')?.addEventListener('click',()=>{const name=root.querySelector('[data-party-invite-name]')?.value?.trim()||'';if(name)socket.sendPartyAction('invite',{name});});
    root.querySelectorAll('[data-party-invite-friend]').forEach(b=>b.addEventListener('click',()=>socket.sendPartyAction('invite',{name:b.dataset.partyInviteFriend})));
    root.querySelector('[data-friend-add]')?.addEventListener('click',()=>{const name=root.querySelector('[data-friend-add-name]')?.value?.trim()||'';if(!name){friendsMessage={ok:false,text:'Informe o nome do personagem.'};render();return;}const current=Array.isArray(state.profile?.friends)?state.profile.friends:[];if(current.length>=50){friendsMessage={ok:false,text:'Sua lista de amigos está cheia. O limite é de 50 amigos por conta.'};render();return;}friendsMessage={ok:true,text:'Verificando personagem...'};render();socket.sendGameAction('friend-add',{name});});
    root.querySelectorAll('[data-friend-remove]').forEach(b=>b.addEventListener('click',()=>socket.sendGameAction('friend-remove',{name:b.dataset.friendRemove})));
    root.querySelectorAll('[data-party-transfer]').forEach(b=>b.addEventListener('click',()=>{
      const member=partyState?.members?.find(m=>String(m.id)===String(b.dataset.partyTransfer));
      if(!member)return;
      if(!window.confirm(`Passar a liderança da Party para ${member.name}?`))return;
      socket.sendPartyAction('transfer-leader',{characterId:b.dataset.partyTransfer});
    }));
    root.querySelectorAll('[data-party-kick]').forEach(b=>b.addEventListener('click',()=>socket.sendPartyAction('kick',{characterId:b.dataset.partyKick})));
    root.querySelector('[data-party-leave]')?.addEventListener('click',()=>socket.sendPartyAction('leave'));
    root.querySelector('[data-party-accept]')?.addEventListener('click',()=>{partyInvite=null;socket.sendPartyAction('accept');render();});
    root.querySelector('[data-party-decline]')?.addEventListener('click',()=>{partyInvite=null;socket.sendPartyAction('decline');render();});
    root.querySelector('[data-guild-boss-accept]')?.addEventListener('click',()=>acceptGuildBossInvite());
    root.querySelector('[data-guild-boss-decline]')?.addEventListener('click',()=>{guildBossInvite=null;render();});

    root.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => setView(el.dataset.view)));
    root.querySelectorAll('[data-pvp-wager-currency]').forEach(button=>button.addEventListener('click',()=>{pvpWagerCurrency=button.dataset.pvpWagerCurrency||'none';if(pvpWagerCurrency==='none')pvpWagerAmount=0;else if(Number(pvpWagerAmount||0)<1)pvpWagerAmount=1;pvpMessage='';render();}));
    root.querySelector('[data-pvp-wager-amount]')?.addEventListener('input',event=>{pvpWagerAmount=Math.max(0,Math.trunc(Number(event.currentTarget.value)||0));const small=event.currentTarget.parentElement?.querySelector('small');if(small){const balance=pvpWagerCurrency==='premium'?Number(state.profile.premiumPoints??state.profile.vipCredits??0):Number(state.profile.bank||0);small.textContent=`Seu saldo: ${balance.toLocaleString('pt-BR')} ${pvpWagerCurrency==='premium'?'PP':'Zeni'} · prêmio: ${(pvpWagerAmount*2).toLocaleString('pt-BR')} ${pvpWagerCurrency==='premium'?'PP':'Zeni'}`;}});
    root.querySelector('[data-pvp-accept]')?.addEventListener('click',()=>{pvpMessage='Aceitando duelo...';socket.sendPvpAction('accept');pvpInvite=null;render();});
    root.querySelector('[data-pvp-decline]')?.addEventListener('click',()=>{socket.sendPvpAction('decline');pvpInvite=null;render();});
    root.querySelector('[data-pvp-refresh]')?.addEventListener('click',()=>{pvpMessage='';pvpLastResult=null;socket.sendPvpAction('status');render();});
    root.querySelectorAll('[data-pvp-challenge]').forEach(button=>button.addEventListener('click',()=>{
      if(!socket.connected){pvpMessage='O PvP requer conexão com o servidor.';render();return;}
      pvpMessage='Enviando desafio PvP...';pvpLastResult=null;
      socket.sendPvpAction('challenge',{characterId:button.dataset.pvpChallenge,...pvpWagerPayload()});render();
    }));
    root.querySelectorAll('[data-pvp-target-id]').forEach(actor=>actor.addEventListener('contextmenu',event=>{
      event.preventDefault();
      event.stopPropagation();
      if(!pvpState||!socket.connected)return;
      socket.sendPvpAction('target',{targetId:actor.dataset.pvpTargetId});
    }));
    root.querySelectorAll('[data-pvp-cast-spell]').forEach(button=>button.addEventListener('click',()=>{
      if(!pvpState||!socket.connected)return;
      const spellId=button.dataset.pvpCastSpell;
      const spell=spells.find(row=>String(row.id)===String(spellId));
      const offensive=spell?.aggressive===true||spell?.runtimeKind==='damage';
      const target=pvpTargetParticipant();
      if(offensive&&!target){pvpMessage='Selecione um target com o botão direito antes de usar uma spell ofensiva.';render();return;}
      socket.sendPvpAction('cast',{spellId,targetId:target?.id||null});
    }));
    root.querySelector('[data-pvp-forfeit]')?.addEventListener('click',()=>{
      if(!pvpState)return;
      if(!window.confirm('Abandonar o duelo PvP? O adversário receberá a vitória.'))return;
      socket.sendPvpAction('forfeit');
    });
    root.querySelector('[data-pvp-arena]')?.addEventListener('click',event=>{
      const own=pvpOwnParticipant();if(!own||!pvpState||Date.now()<Number(pvpState.startsAt||0))return;
      const arena=event.currentTarget,rect=arena.getBoundingClientRect();
      const width=Math.max(2,Number(arena.dataset.pvpWidth||pvpState.width||24)),height=Math.max(2,Number(arena.dataset.pvpHeight||pvpState.height||14));
      // Inverso exato da projeção usada em positionStyle(): sem isto, clicar
      // no fundo da arena mandaria o personagem para o tile errado.
      const fx=(event.clientX-rect.left)/Math.max(1,rect.width);
      const fy=(event.clientY-rect.top)/Math.max(1,rect.height);
      const row=Math.max(0,Math.min(1,(fy*100-PVP_TOP)/(100-PVP_TOP)));
      const scale=PVP_FAR+row*(1-PVP_FAR);
      const depthRatio=(1-PVP_FAR/scale)/(1-PVP_FAR);
      const columnRatio=(fx-0.5)/scale+0.5;
      const targetX=Math.max(0,Math.min(width-1,Math.round(columnRatio*(width-1))));
      const targetY=Math.max(0,Math.min(height-1,Math.round(depthRatio*(height-1))));
      const dx=targetX-Number(own.x||0),dy=targetY-Number(own.y||0);
      if(dx===0&&dy===0)return;
      const step=Math.abs(dx)>=Math.abs(dy)?[Math.sign(dx),0]:[0,Math.sign(dy)];
      socket.sendPvpAction('move',{dx:step[0],dy:step[1]});
    });
    bindMarketEvents();
    bindMarketDialogEvents();
    bindVipEvents();
    bindPremiumPurchaseEvents();

    bindTransformButton();

    root.querySelector('[data-action="switch-character"]')
      ?.addEventListener('click', async event => {
        if (!['world','hunt','training'].includes(activeView) || characterSwitchSaving) return;
        characterSwitchSaving=true;
        const button=event.currentTarget;
        const previousHtml=button?.innerHTML||'';
        if(button){button.disabled=true;button.textContent='Salvando...';}
        let serverConfirmed=false;
        // V21.25.3: a troca de personagem e uma transacao do servidor. Se o
        // personagem estiver em Hunt/Training, o backend encerra a atividade,
        // grava o snapshot autoritativo e so entao libera a troca.
        if(socket.connected){
          const checkpoint=await socket.requestCharacterExit?.(20000);
          if(!checkpoint?.ok){
            characterSwitchSaving=false;
            if(button){button.disabled=false;button.innerHTML=previousHtml;}
            window.alert(checkpoint?.message||'Nao foi possivel confirmar o save. Tente novamente.');
            return;
          }
          serverConfirmed=true;
        }else{
          persist();
        }
        mapRenderer?.destroy();
        huntRenderer?.destroy();
        trainingRenderer?.destroy();
        hunt.destroy();
        training.destroy?.();
        socket.disconnect?.();
        onSwitchCharacter({serverConfirmed});
      });
    root.querySelectorAll('[data-open-depot-tab]').forEach(element=>element.addEventListener('click',()=>{const id=element.dataset.openDepotTab;if((state.vipDepotContainerIds||[]).includes(id)&&Number(state.profile?.vipUntil||0)<=Date.now())return;openDepotContainerId=id;render();}));

    root.querySelectorAll('[data-open-container]').forEach(element =>
      element.addEventListener('click', event => {
        event.stopPropagation();
        const id = element.dataset.openContainer;
        if (!id) return;
        const path = containerPath(state, id);
        const rootContainer = path[0] || openContainer(state, id);
        if (rootContainer?.id === state.depotContainerId) {
          openDepotContainerId = id;
        } else if (!openContainerIds.includes(id)) {
          openContainerIds.push(id);
        }
        render();
      })
    );
    root.querySelectorAll('[data-action="close-container"]')
      .forEach(button => button.addEventListener('click', () => {
        if (button.dataset.closeContainerKind === 'depot') {
          openDepotContainerId = null;
        } else {
          const id = button.dataset.closeContainerId;
          openContainerIds = openContainerIds.filter(entry => entry !== id);
        }
        render();
      }));
    bindContainerWindowDrag();
    root.querySelectorAll('.container-window-backdrop').forEach(backdrop => {
      const container = openContainer(state,backdrop.dataset.containerTargetId);
      if (container) backdrop.dataset.containerSignature = JSON.stringify(container.items || []);
    });
    root.querySelector('[data-action="toggle-hunt-analyser"]')
      ?.addEventListener('click',()=>{huntAnalyserOpen=!huntAnalyserOpen;render();});
    root.querySelector('[data-action="close-hunt-analyser"]')
      ?.addEventListener('click',()=>{huntAnalyserOpen=false;render();});
    root.querySelector('[data-action="reset-hunt-analyser"]')
      ?.addEventListener('click',()=>{socket.sendGameAction('hunt-analyser-reset');setTimeout(()=>render(),250);});
    root.querySelector('[data-action="offline-start"]')
      ?.addEventListener('click',()=>{socket.sendGameAction('offline-start');setTimeout(()=>render(),350);});
    root.querySelector('[data-action="offline-stop"]')
      ?.addEventListener('click',()=>{socket.sendGameAction('offline-stop');setTimeout(()=>render(),350);});
    const analyserWindow=root.querySelector('.hunt-analyser-window');const analyserHandle=analyserWindow?.querySelector('[data-analyser-drag-handle]');
    analyserHandle?.addEventListener('pointerdown',event=>{if(event.target.closest('button'))return;event.preventDefault();const rect=analyserWindow.getBoundingClientRect();const dx=event.clientX-rect.left,dy=event.clientY-rect.top;analyserHandle.setPointerCapture?.(event.pointerId);const move=e=>{const x=Math.max(0,Math.min(window.innerWidth-analyserWindow.offsetWidth,e.clientX-dx));const y=Math.max(42,Math.min(window.innerHeight-analyserWindow.offsetHeight,e.clientY-dy));analyserWindow.style.left=`${x}px`;analyserWindow.style.top=`${y}px`;analyserWindow.style.right='auto';huntAnalyserPosition={x,y};};const up=()=>{analyserHandle.removeEventListener('pointermove',move);analyserHandle.removeEventListener('pointerup',up);try{localStorage.setItem('dbo-hunt-analyser-position',JSON.stringify(huntAnalyserPosition))}catch{}};analyserHandle.addEventListener('pointermove',move);analyserHandle.addEventListener('pointerup',up);});

    root.querySelector('#hunt-fab')
      ?.addEventListener('click', openHuntChooser);
    root.querySelector('[data-action="switch-hunt"]')
      ?.addEventListener('click', openHuntChooser);
    root.querySelectorAll('[data-hunt-content-tab]').forEach(button =>
      button.addEventListener('click', () => {
        huntContentTab=button.dataset.huntContentTab;
        huntPage=0;
        pendingHuntZoneId=null;
        render();
      })
    );

    root.querySelector('[data-reborn-quest-choice]')
      ?.addEventListener('click', () => {
        const zone = currentRebornZone();
        if (!zone) return;
        pendingHuntZoneId = zone.id;
        pendingLureCount = 1;
        render();
      });
    root.querySelectorAll('[data-progression-quest-start]').forEach(button=>button.addEventListener('click',()=>{
      if(partyState&&!partyState.isLeader){log('Somente o líder da Party pode iniciar a Quest para o grupo.');return;}
      if(partyState)socket.sendPartyAction('start-expedition',{questId:button.dataset.progressionQuestStart});
      else if(socket.connected)socket.sendGameAction('progression-quest-start',{questId:button.dataset.progressionQuestStart});
      else localStartProgressionQuest(button.dataset.progressionQuestStart);
    }));
    root.querySelectorAll('[data-quest-move]').forEach(button=>button.addEventListener('click',()=>{
      const canControl=!partyState||partyState.isLeader;if(!canControl)return;const [dx,dy]=String(button.dataset.questMove||'0,0').split(',').map(Number);
      if(partyState)socket.sendPartyAction('expedition-move',{dx,dy});else if(socket.connected)socket.sendGameAction('progression-quest-move',{dx,dy});else localMoveProgressionQuest(dx,dy);
    }));
    root.querySelectorAll('[data-quest-tab]').forEach(button=>button.addEventListener('click',()=>{questTab=button.dataset.questTab||'all';questPage=0;render();}));
    root.querySelectorAll('[data-quest-page]').forEach(button=>button.addEventListener('click',()=>{questPage=Math.max(0,Number(button.dataset.questPage)||0);render();}));
    root.querySelector('[data-action="stop-progression-expedition"]')?.addEventListener('click',()=>{
      if(partyState?.isLeader)socket.sendPartyAction('stop-expedition');
      else if(!partyState&&socket.connected)socket.sendGameAction('progression-quest-stop');
      else if(!partyState){abandonProgressionQuest(state);hunt.stop();activeView='world';huntChooserOpen=true;persist();render();}
    });

    root.querySelectorAll('[data-hunt-choice]').forEach(el =>
      el.addEventListener('click', () => {
        pendingHuntZoneId = el.dataset.huntChoice;
        const zone = zones.find(item => item.id === pendingHuntZoneId) || zones[0];
        pendingLureCount = zone.defaultLure || allowedLureCounts(zone)[0];
        render();
      })
    );

    root.querySelector('[data-action="hunt-page-prev"]')
      ?.addEventListener('click', () => { huntPage=Math.max(0,huntPage-1); render(); });
    root.querySelector('[data-action="hunt-page-next"]')
      ?.addEventListener('click', () => { huntPage+=1; render(); });
    root.querySelector('[data-action="toggle-hunt-favorites"]')
      ?.addEventListener('click', () => {
        huntFavoritesOnly=!huntFavoritesOnly;
        huntPage=0;
        render();
      });
    root.querySelector('[data-hunt-search]')?.addEventListener('input', event => {
      huntSearchQuery=event.target.value;
      huntPage=0;
      render();
    });
    root.querySelector('[data-hunt-min-level]')?.addEventListener('input', event => {
      huntMinLevel=event.target.value;
      huntPage=0;
      render();
    });
    root.querySelector('[data-hunt-max-level]')?.addEventListener('input', event => {
      huntMaxLevel=event.target.value;
      huntPage=0;
      render();
    });
    root.querySelectorAll('[data-action="toggle-hunt-favorite"]').forEach(button =>
      button.addEventListener('click', () => {
        const zoneId=button.dataset.zoneId;
        state.hunt.favoriteZoneIds ||= [];
        const index=state.hunt.favoriteZoneIds.indexOf(zoneId);
        if (index>=0) state.hunt.favoriteZoneIds.splice(index,1);
        else state.hunt.favoriteZoneIds.push(zoneId);
        persist();
        render();
      })
    );

    root.querySelector('[data-hunt-detail-lure]')
      ?.addEventListener('change', event => {
        pendingLureCount = Number(event.target.value);
        render();
      });
    root.querySelector('[data-action="confirm-hunt"]')
      ?.addEventListener('click', confirmHunt);
    root.querySelectorAll('[data-action="close-hunt-picker"]')
      .forEach(el => el.addEventListener('click', () => {
        huntChooserOpen = false;
        render();
      }));
    root.querySelector('[data-action="close-hunt-picker-backdrop"]')
      ?.addEventListener('click', event => {
        if (event.target !== event.currentTarget) return;
        huntChooserOpen = false;
        render();
      });
    root.querySelector('[data-action="close-hunt-detail-backdrop"]')
      ?.addEventListener('click', event => {
        if (event.target !== event.currentTarget) return;
        pendingHuntZoneId = null;
        render();
      });


    root.querySelector('[data-action="open-vendor"]')
      ?.addEventListener('click', () => {
        if (activeView !== 'world') return;
        vendorOpen = true;
        render();
      });
    root.querySelectorAll('[data-action="close-vendor"]').forEach(button =>
      button.addEventListener('click', () => {
        vendorOpen = false;
        persist();
        render();
      })
    );
    root.querySelectorAll('[data-action="close-reborn"]').forEach(button =>
      button.addEventListener('click', () => {
        rebornNpcOpen = false;
        render();
      })
    );
    root.querySelectorAll('[data-action="confirm-reborn"]').forEach(button =>
      button.addEventListener('click', () => performReborn(button.dataset.rebornPath || null))
    );
    root.querySelector('.reborn-npc-backdrop')
      ?.addEventListener('click', event => {
        if (event.target !== event.currentTarget) return;
        rebornNpcOpen = false;
        render();
      });
    root.querySelectorAll('[data-toggle-sale-lock]').forEach(button =>
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const [containerId,indexText,itemId,instanceId] = String(button.dataset.toggleSaleLock || '').split(':');
        const index=Number(indexText);
        const entry=state.containers?.[containerId]?.items?.[index];
        if(!entry)return;
        if(socket.connected){
          socket.sendGameAction('toggle-item-lock',{containerId,index,itemId:itemId||entry.itemId,instanceId:instanceId||entry.instanceId||null});
          return;
        }
        entry.locked=!Boolean(entry.locked);
        log(`${itemCatalog[entry.itemId]?.name || 'Item'} ${entry.locked ? 'protegido contra venda' : 'desprotegido'}.`);
        persist();render();
      })
    );
    root.querySelectorAll('[data-sell-item]').forEach(button =>
      button.addEventListener('click', () => {
        const [containerId,index] = button.dataset.sellItem.split(':');
        const result=sellEntry(containerId, Number(index));
        if (result === true) {
          persist();
          render();
        }
      })
    );
    root.querySelector('[data-action="sell-all"]')
      ?.addEventListener('click', () => {
        if(socket.connected){
          socket.sendGameAction('sell-all');
          return;
        }
        const entries = sellableEntries().sort((a,b) => b.index - a.index);
        for (const entry of entries) sellEntry(entry.container.id, entry.index);
        persist();render();
      });


    root.querySelector('#training-fab')
      ?.addEventListener('click', openTrainingChooser);
    root.querySelectorAll('[data-training-room]').forEach(button =>
      button.addEventListener('click', () => {
        pendingTrainingRoomId = button.dataset.trainingRoom;
        render();
      })
    );
    root.querySelectorAll('[data-action="close-training-chooser"]')
      .forEach(button => button.addEventListener('click', () => {
        trainingChooserOpen = false;
        render();
      }));
    root.querySelector('[data-action="confirm-training"]')
      ?.addEventListener('click', confirmTraining);
    root.querySelector('[data-action="stop-training"]')
      ?.addEventListener('click', () => {
        training.stop();
        activeView = 'world';
        render();
      });

    root.querySelector('[data-action="close-npc-shop"]')
      ?.addEventListener('click', () => {
        npcSelectedSellKeys = new Set();
        npcShopOpen = false;
        render();
      });

    root.querySelectorAll('[data-npc-tab]').forEach(button =>
      button.addEventListener('click', () => {
        npcShopTab = button.dataset.npcTab;
        npcSelectedSellKeys = new Set();
        render();
      })
    );

    root.querySelectorAll('[data-npc-select-buy]').forEach(button =>
      button.addEventListener('click', () => {
        npcSelectedBuyId = button.dataset.npcSelectBuy;
        npcBuyQuantity = 1;
        render();
      })
    );

    root.querySelector('#npc-buy-quantity')
      ?.addEventListener('change', event => {
        npcBuyQuantity = Math.max(
          1,
          Math.min(1000, Number(event.target.value) || 1)
        );
        render();
      });

    root.querySelectorAll('[data-npc-quantity-step]').forEach(button =>
      button.addEventListener('click', () => {
        npcBuyQuantity = Math.max(
          1,
          Math.min(
            1000,
            Number(npcBuyQuantity) +
            Number(button.dataset.npcQuantityStep || 0)
          )
        );
        render();
      })
    );

    root.querySelectorAll('[data-npc-add-quantity]').forEach(button =>
      button.addEventListener('click', () => {
        npcBuyQuantity = Math.min(
          1000,
          Number(npcBuyQuantity) +
          Number(button.dataset.npcAddQuantity || 0)
        );
        render();
      })
    );

    root.querySelector('[data-npc-set-quantity]')
      ?.addEventListener('click', buttonEvent => {
        const requested = Number(
          buttonEvent.currentTarget.dataset.npcSetQuantity
        ) || 1;
        const selectedEntry = npcBuyCatalog().find(
          entry => entry.item.id === npcSelectedBuyId
        );
        const price = Number(selectedEntry?.price || 0);
        const affordable = price > 0
          ? Math.floor(Number(state.profile.bank || 0) / price)
          : requested;
        // MAX should land on however many the player can actually
        // afford, not always jump to the 1000 cap and leave them staring
        // at a purchase they can't complete.
        npcBuyQuantity = Math.max(
          1,
          Math.min(requested, affordable || 1, 1000)
        );
        render();
      });

    root.querySelector('[data-npc-confirm-buy]')
      ?.addEventListener('click', event => {
        const button = event.currentTarget;
        const itemId = button.dataset.npcConfirmBuy;
        const item = itemCatalog[itemId];
        const unitPrice = Number(button.dataset.unitPrice || 0);
        const requested = Math.max(
          1,
          Math.min(1000, Number(npcBuyQuantity) || 1)
        );
        const totalPrice = unitPrice * requested;

        if (!item) return;
        if (Number(state.profile.bank || 0) < totalPrice) {
          log('Você não possui Gold suficiente no banco.');
          return;
        }

        let purchased = 0;
        if (item.type === 'backpack') {
          for (let index = 0; index < requested; index += 1) {
            const result = addItemToInventory(
              state,
              itemId,
              1,
              itemCatalog
            );
            if (!result.ok) break;
            purchased += 1;
          }
        } else {
          const result = addItemToInventory(
            state,
            itemId,
            requested,
            itemCatalog
          );
          if (result.ok) purchased = requested;
        }

        if (!purchased) {
          log('Backpack cheia. Nenhum item foi comprado.');
          return;
        }

        const charged = unitPrice * purchased;
        state.profile.bank -= charged;
        socket?.sendGameAction('buy',{itemId,quantity:purchased});
        log(
          `${purchased}× ${item.name} comprado por ` +
          `${charged.toLocaleString('pt-BR')} Gold.`
        );
        if (purchased < requested) {
          log(
            `Somente ${purchased} unidade(s) couberam nas backpacks.`
          );
        }
        persist();
        render();
      });

    root.querySelectorAll('[data-npc-toggle-sell]').forEach(button =>
      button.addEventListener('click', () => {
        const key = button.dataset.npcToggleSell;
        if (npcSelectedSellKeys.has(key)) {
          npcSelectedSellKeys.delete(key);
        } else {
          npcSelectedSellKeys.add(key);
        }
        render();
      })
    );

    root.querySelector('[data-npc-select-all]')
      ?.addEventListener('click', () => {
        npcSelectedSellKeys = new Set(
          npcSellableEntries().filter(({entry})=>!entry.locked).map(({container,index}) =>
            npcSellKey(container.id, index)
          )
        );
        render();
      });

    root.querySelector('[data-npc-clear-selection]')
      ?.addEventListener('click', () => {
        npcSelectedSellKeys = new Set();
        render();
      });

    root.querySelector('[data-npc-sell-selected]')
      ?.addEventListener('click', () => {
        const entries = selectedNpcSellEntries().sort((a,b) => {
          if (a.container.id !== b.container.id) {
            return a.container.id.localeCompare(b.container.id);
          }
          return b.index - a.index;
        });
        let sold = 0;
        for (const entry of entries) {
          if (sellEntry(entry.container.id, entry.index)) sold += 1;
        }
        npcSelectedSellKeys = new Set();
        if (sold) {
          persist();
          render();
        }
      });

    root.querySelector('[data-npc-sell-below-rarity]')
      ?.addEventListener('change', event => {
        const requested = rarityDefinition(event.currentTarget.value);
        npcSellBelowRarity = requested.tier > 0 ? requested.id : 'legendary';
        state.settings ||= {};
        state.settings.npcSellBelowRarity = npcSellBelowRarity;
        persist();
        render();
      });

    root.querySelector('[data-npc-sell-all]')
      ?.addEventListener('click', () => {
        npcSelectedSellKeys = new Set();
        const threshold = npcSellBelowDefinition();
        if(socket.connected){
          socket.sendGameAction('sell-all',{belowRarity:threshold.id});
          return;
        }
        const entries = npcBulkSellEntries().sort((a,b) => {
          if (a.container.id !== b.container.id) return a.container.id.localeCompare(b.container.id);
          return b.index - a.index;
        });
        let sold = 0;
        for (const entry of entries) if (sellEntry(entry.container.id, entry.index)) sold += 1;
        if (sold) { persist(); render(); }
      });

    root.querySelector('[data-action="open-loot-config"]')
      ?.addEventListener('click', () => {
        lootConfigOpen = true;
        render();
      });
    root.querySelectorAll('[data-action="close-loot-config"]')
      .forEach(element => element.addEventListener('click', () => {
        lootConfigOpen = false;
        persist();
        render();
      }));
    root.querySelectorAll('[data-loot-ignore]').forEach(element =>
      element.addEventListener('change', () => {
        state.hunt.lootFilter ||= {ignored:[]};
        const ignored = new Set(state.hunt.lootFilter.ignored || []);
        if (element.checked) ignored.add(element.dataset.lootIgnore);
        else ignored.delete(element.dataset.lootIgnore);
        state.hunt.lootFilter.ignored = [...ignored];
        persist();
        render();
      })
    );

    root.querySelector('[data-action="request-stop-hunt"]')
      ?.addEventListener('click', () => {
        stopHuntConfirmOpen = true;
        render();
      });
    root.querySelector('[data-action="cancel-stop-hunt"]')?.addEventListener('click',()=>{stopHuntConfirmOpen=false;render();});
    root.querySelector('[data-action="confirm-stop-hunt"]')?.addEventListener('click',()=>{stopHuntConfirmOpen=false;hunt.stop();activeView='world';resetToEarth(state);restoreInPz();persist();render();});
    root.querySelector('#hunt-lure-select')
      ?.addEventListener('change', event => {
        hunt.setLureCount?.(Number(event.target.value));
        persist();
      });

    root.querySelectorAll('[data-cast-spell-slot]').forEach(button =>
      button.addEventListener('click', () => {
        const slot = Number(button.dataset.castSpellSlot);
        const spellId = button.dataset.spellId;

        if (!spellId) {
          spellBookSlot = slot;
          render();
          return;
        }

        if (state.settings.spellBar.enabled[slot] === false) {
          log(`A spell do slot ${slot + 1} está desativada.`);
          return;
        }

        const remainingMs =
          spellController.cooldownRemaining(spellId);
        if (remainingMs > 0) {
          log(
            `Spell não utilizada: aguarde ` +
            `${(remainingMs / 1000).toFixed(1)}s.`
          );
          updateSpellCooldowns();
          return;
        }

        const result = castSupportSpell(null,spellId);
        if (!result.ok) {
          log(`Spell não utilizada: ${result.message}`);
        } else {
          log(
            result.damage
              ? `${result.spell.name}: ${result.damage} de dano.`
              : `${result.spell.name} ativada.`
          );
        }

        persist();
        updateDynamicPanels();
        updateSpellCooldowns();
      })
    );

    root.querySelectorAll('[data-configure-spell-slot]').forEach(button =>
      button.addEventListener('click', () => {
        spellBookSlot = Number(button.dataset.configureSpellSlot);
        render();
      })
    );

    root.querySelector('[data-guild-boss-taunt]')?.addEventListener('click',()=>{
      const remaining=Math.max(0,guildBossTauntCooldownUntil-Date.now());if(remaining>0){log(`Provocação em cooldown por ${Math.ceil(remaining/1000)}s.`);return;}
      guildBossTauntCooldownUntil=Date.now()+10000;socket.sendGuildBossTaunt();updateGuildBossTauntCooldown();
    });

    root.querySelectorAll('[data-configure-support-spell]').forEach(button =>
      button.addEventListener('click', () => {
        spellBookSlot = button.dataset.configureSupportSpell;
        render();
      })
    );

    root.querySelectorAll('[data-cast-support-spell]').forEach(button =>
      button.addEventListener('click', () => {
        const kind = button.dataset.castSupportSpell;
        const spellId = button.dataset.spellId;
        if (!spellId) {
          spellBookSlot = kind;
          render();
          return;
        }
        const result = spellController.cast(spellId);
        if (!result.ok) {
          log(`Spell não utilizada: ${result.message}`);
        } else {
          log(`${result.spell.name} ativada.`);
        }
        persist();
        updateDynamicPanels();
        updateSpellCooldowns();
      })
    );

    root.querySelectorAll('[data-support-auto]').forEach(input =>
      input.addEventListener('change', () => {
        const kind = input.dataset.supportAuto;
        state.settings.spellBar.support[kind].auto = input.checked;
        persist();
      })
    );

    root.querySelector('[data-support-heal-threshold]')
      ?.addEventListener('change', event => {
        state.settings.spellBar.support.healing.threshold =
          Number(event.target.value);
        persist();
      });

    root.querySelector('[data-action="clear-spell-bar"]')
      ?.addEventListener('click', () => {
        if (!confirm('Limpar todas as spells da barra?')) return;
        state.settings.spellBar.slots = Array(4).fill(null);
        state.settings.spellBar.auto = Array(4).fill(false);
        state.settings.spellBar.enabled = Array(4).fill(true);
        persist();
        render();
      });

    root.querySelectorAll('[data-spell-auto-slot]').forEach(input =>
      input.addEventListener('change', () => {
        const slot = Number(input.dataset.spellAutoSlot);
        state.settings.spellBar.auto[slot] = input.checked;
        persist();
        updateDynamicPanels();
      })
    );

    root.querySelectorAll('[data-assign-spell]').forEach(button =>
      button.addEventListener('click', () => {
        const spellId = button.dataset.assignSpell || null;

        if (Number.isInteger(spellBookSlot)) {
          const slot = Number(spellBookSlot);
          state.settings.spellBar.slots[slot] = spellId;
          if (!spellId) state.settings.spellBar.auto[slot] = false;
        } else {
          const kind = String(spellBookSlot || 'status');
          state.settings.spellBar.support[kind].spellId = spellId;
          if (!spellId) {
            state.settings.spellBar.support[kind].auto = false;
          }
        }

        spellBookSlot = null;
        persist();
        render();
      })
    );

    root.querySelector('[data-spell-min-targets]')
      ?.addEventListener('change', event => {
        const slot=Number(event.target.dataset.spellMinTargets);
        state.settings.spellBar.minTargets[slot]=
          Number(event.target.value);
        persist();
      });

    root.querySelector('[data-spell-slot-enabled]')
      ?.addEventListener('change', event => {
        const slot = Number(event.target.dataset.spellSlotEnabled);
        state.settings.spellBar.enabled[slot] = event.target.checked;
        persist();
        render();
      });

    root.querySelector('[data-action="close-spell-book"]')
      ?.addEventListener('click', () => {
        spellBookSlot = null;
        render();
      });

    root.querySelector('.spell-book-backdrop')
      ?.addEventListener('click', event => {
        if (event.target !== event.currentTarget) return;
        spellBookSlot = null;
        render();
      });

    root.querySelectorAll('[data-quick-consumable]').forEach(button=>button.addEventListener('click',()=>useQuickConsumable(button.dataset.quickConsumable)));
    root.querySelectorAll('[data-auto-consumable]').forEach(input=>
      input.addEventListener('change',()=>{
        state.settings.autoConsumables[input.dataset.autoConsumable].enabled=input.checked;persist();
      })
    );

    root.querySelectorAll('[data-open-consumable-config]').forEach(button =>
      button.addEventListener('click', () => {
        consumableConfigOpen = button.dataset.openConsumableConfig;
        render();
      })
    );

    root.querySelectorAll('[data-action="close-consumable-config"],'
      + '[data-action="confirm-consumable-config"]').forEach(button =>
      button.addEventListener('click', () => {
        consumableConfigOpen = null;
        persist();
        render();
      })
    );

    root.querySelector('[data-action="clear-consumable-slot"]')
      ?.addEventListener('click', () => {
        const config = state.settings.autoConsumables[
          consumableConfigOpen
        ];
        config.itemId = null;
        if (consumableConfigOpen === 'senzu') config.autoBest = false;
        config.enabled = false;
        persist();
        rerenderConsumableConfigPreservingScroll();
      });

    root.querySelectorAll('[data-select-consumable]').forEach(button =>
      button.addEventListener('click', () => {
        const config = state.settings.autoConsumables[
          consumableConfigOpen
        ];
        const rawValue = button.dataset.selectConsumable || null;
        const useBest = consumableConfigOpen === 'senzu' && rawValue === '__best__';
        const itemId = useBest ? config.itemId : rawValue;
        config.autoBest = useBest;
        if (!useBest) config.itemId = itemId;
        config.enabled = Boolean(useBest || itemId);
        persist();
        rerenderConsumableConfigPreservingScroll();
      })
    );

    root.querySelectorAll('[data-threshold-step]').forEach(button =>
      button.addEventListener('click', () => {
        const values = [25,50,75,90];
        const config = state.settings.autoConsumables[
          consumableConfigOpen
        ];
        if (consumableConfigOpen === 'senzu') return;
        const current = values.indexOf(Number(config.threshold || 50));
        const next = Math.max(
          0,
          Math.min(
            values.length - 1,
            current + Number(button.dataset.thresholdStep)
          )
        );
        config.threshold = values[next];
        persist();
        render();
      })
    );
    root.querySelectorAll('[data-senzu-threshold]').forEach(select =>
      select.addEventListener('change', () => {
        state.settings.autoConsumables.senzu[select.dataset.senzuThreshold] = Number(select.value);
        persist();
      })
    );
    root.querySelectorAll('[data-auto-threshold]').forEach(select=>
      select.addEventListener('change',()=>{
        state.settings.autoConsumables[select.dataset.autoThreshold].threshold=Number(select.value);persist();
      })
    );
    root.querySelector('[data-senzu-item-select]')?.addEventListener('change',event=>{
      state.settings.autoConsumables.senzu.itemId=event.target.value;state.settings.autoConsumables.senzu.autoBest=false;persist();rerenderConsumableConfigPreservingScroll();
    });
    root.querySelector('[data-action="start-hunt"]')?.addEventListener('click', () => { hunt.start(); render(); });
    root.querySelector('[data-action="stop-hunt"]')?.addEventListener('click', () => { hunt.stop(); activeView='world'; resetToEarth(state); restoreInPz(); persist(); render(); });
    root.querySelectorAll('[data-zone]').forEach(el => el.addEventListener('click', () => { hunt.setZone(el.dataset.zone); render(); }));
    root.querySelector('[data-action="toggle-progression"]')
      ?.addEventListener('click', () => {
        progressionOpen=!progressionOpen;
        render();
      });

    root.querySelectorAll('[data-chat-tab]').forEach(button =>
      button.addEventListener('click', () => {
        activeChatTab=button.dataset.chatTab;
        render();
      })
    );

    root.querySelector('#chat-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = root.querySelector('#chat-input');
      const text = input.value.trim();
      if (!text) return;
      if(socket.connected || socket.social){
        // Comandos e mensagens passam pelo servidor. O echo oficial evita
        // duplicar a mensagem do proprio player no Default.
        socket.sendChat(text);
      }else if(!text.startsWith('/')){
        state.chat.push({id:crypto.randomUUID?.() || Date.now(),author:state.profile.name,text,at:Date.now(),system:false,channel:'default'});
        state.chat=state.chat.slice(-120);
        saveState(state);
      }
      input.value = '';
      renderChatOnly();
    });
    root.querySelectorAll('[data-item]').forEach(el => el.addEventListener('click', () => useItem(el.dataset.item,el.dataset.instanceId||null)));
    root.querySelectorAll('[data-unequip]').forEach(el =>
      el.addEventListener('click', () => {
        const slot = el.dataset.unequip;
        if (!slot) return;
        if (socket.connected) {
          socket.sendGameAction('unequip-item', {slot});
          return;
        }
        const result = unequipToBackpack(state, slot, itemCatalog);
        log(result.message);
        if (result.ok) {
          persist();
          render();
        }
      })
    );
    const setDragMapState = active => {
      root.querySelector('.world-stage')
        ?.classList.toggle('drag-item-active', active);
    };

    root.querySelectorAll('[data-drag-equipment]').forEach(element => {
      element.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'move';
        const payload = JSON.stringify({
          source:'equipment',
          slot:element.dataset.dragEquipment
        });
        event.dataTransfer.setData('application/x-dbo-item', payload);
        event.dataTransfer.setData('text/plain', payload);
        setDragMapState(true);
      });
      element.addEventListener('dragend', () => setDragMapState(false));
    });
    root.querySelectorAll('[data-drag-container]').forEach(element => {
      element.addEventListener('dragstart', event => {
        const container=state.containers?.[element.dataset.dragContainer];
        if(container?.layoutLocked){event.preventDefault();log('A organização desta backpack está travada.');return;}
        event.dataTransfer.effectAllowed = 'move';
        const payload = JSON.stringify({
          source:'container',
          containerId:element.dataset.dragContainer,
          index:Number(element.dataset.dragIndex)
        });
        event.dataTransfer.setData('application/x-dbo-item', payload);
        event.dataTransfer.setData('text/plain', payload);
        setDragMapState(true);
      });
      element.addEventListener('dragend', () => setDragMapState(false));
    });

    root.querySelectorAll('[data-container-lock]').forEach(button =>
      button.addEventListener('click', event => {
        event.preventDefault();event.stopPropagation();
        const id=button.dataset.containerLock;
        const container=state.containers?.[id];if(!container)return;
        setContainerLayoutLocked(state,id,!container.layoutLocked);
        log(container.layoutLocked?'Organização do container travada.':'Organização do container destravada.');
        persist();render();
      })
    );
    root.querySelectorAll('[data-container-organize]').forEach(button=>button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const id=button.dataset.containerOrganize,container=state.containers?.[id];
      if(!container)return;
      const result=autoOrganizeContainer(state,id,itemCatalog);
      if(!result.ok){log(result.reason==='layout-locked'?'Destrave o cadeado antes de organizar o container.':'Não foi possível organizar o container.');return;}
      log(`Container organizado · ${result.count} pilha(s)/item(ns).`);persist();render();
    }));
    root.querySelectorAll('[data-container-loot-filter]').forEach(input =>
      input.addEventListener('change', event => {
        event.stopPropagation();
        const id=input.dataset.containerLootFilter;
        const categories=[...root.querySelectorAll(`[data-container-loot-filter="${CSS.escape(id)}"]`)]
          .filter(entry=>entry.checked).map(entry=>entry.value);
        setContainerLootFilter(state,id,categories);
        persist();
      })
    );

    root.querySelectorAll('[data-container-slot]').forEach(target => {
      if(target.dataset.nestedContainerTarget)return;
      target.addEventListener('dragover', event => {
        const rawTypes=[...event.dataTransfer.types];
        if(!rawTypes.includes('application/x-dbo-item')&&!rawTypes.includes('text/plain'))return;
        event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
        target.classList.add('container-slot-ready');
      });
      target.addEventListener('dragleave',()=>target.classList.remove('container-slot-ready'));
      target.addEventListener('drop',event=>{
        event.preventDefault();event.stopPropagation();target.classList.remove('container-slot-ready');
        const raw=event.dataTransfer.getData('application/x-dbo-item')||event.dataTransfer.getData('text/plain');if(!raw)return;
        try{
          const data=JSON.parse(raw);
          if(data.source==='equipment'&&data.slot==='backpack'){
            const backdrop=target.closest('.container-window-backdrop');
            const targetContainerId=target.dataset.containerSlotContainer;
            if(backdrop?.dataset.containerWindowKind!=='depot'){
              log('A Backpack equipada só pode ser movida inteira para o Depot ou para o chão.');return;
            }
            if(socket.connected){socket.sendGameAction('unequip-backpack',{targetContainerId});return;}
            const result=unequipBackpackToContainer(state,targetContainerId);
            log(result.message);if(result.ok){persist();render();}return;
          }
          if(data.source==='ground'||data.source==='container'){
            queueStackMove(data,{kind:'slot',targetContainerId:target.dataset.containerSlotContainer,targetSlot:Number(target.dataset.containerSlot)});
            return;
          }
        }catch{log('Não foi possível reorganizar este slot.');}
      });
    });


    root.querySelectorAll('[data-nested-container-target]').forEach(target => {
      target.addEventListener('dragover', event => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        target.classList.add('container-drop-ready');
      });
      target.addEventListener('dragleave', () => target.classList.remove('container-drop-ready'));
      target.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        target.classList.remove('container-drop-ready');
        const raw=event.dataTransfer.getData('application/x-dbo-item') || event.dataTransfer.getData('text/plain');
        if(!raw)return;
        try{
          const data=JSON.parse(raw);
          if(data.source==='equipment'&&data.slot==='backpack'){
            const targetId=target.dataset.nestedContainerTarget,targetContainer=state.containers?.[targetId],parent=state.containers?.[targetContainer?.parentId];
            const index=(parent?.items||[]).findIndex(entry=>String(entry.containerId||'')===String(targetId));
            if(!targetContainer||!parent||index<0){log('Não foi possível localizar a Backpack de destino.');return;}
            const entry=parent.items[index];
            if(socket.connected)socket.sendGameAction('equip-item',{itemId:entry.itemId,instanceId:entry.instanceId||null,slot:'backpack'});
            else{const swapped=equipFromContainer(state,parent.id,index,itemCatalog,'backpack');log(swapped.message);if(swapped.ok){persist();render();}}
            return;
          }
          if(data.source==='ground'||data.source==='container'){
            queueStackMove(data,{kind:'container',targetContainerId:target.dataset.nestedContainerTarget});
            return;
          }
        }catch{log('Não foi possível mover a backpack.');}
      });
    });

    root.querySelectorAll('[data-equip-drop]').forEach(slotElement => {
      slotElement.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      slotElement.addEventListener('drop', event => {
        event.preventDefault();
        const raw =
          event.dataTransfer.getData('application/x-dbo-item') ||
          event.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
          const data = JSON.parse(raw);
          if (data.source !== 'container') return;
          if (socket.connected) {
            const found = findEntryByLocation(state,data.containerId,data.index);
            if (!found?.entry?.itemId) {
              log('Item não encontrado.');
              return;
            }
            socket.sendGameAction('equip-item', {
              itemId:found.entry.itemId,
              instanceId:found.entry.instanceId||null,
              slot:slotElement.dataset.equipDrop
            });
            return;
          }
          const result = equipFromContainer(
            state,
            data.containerId,
            data.index,
            itemCatalog,
            slotElement.dataset.equipDrop
          );
          log(result.message);
          if (result.ok) {
            persist();
            render();
          }
        } catch {
          log('Não foi possível equipar o item.');
        }
      });
    });

    root.querySelectorAll('.container-window').forEach(target => {
      target.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        target.classList.add('container-drop-ready');
      });
      target.addEventListener('dragleave', event => {
        if (!target.contains(event.relatedTarget)) {
          target.classList.remove('container-drop-ready');
        }
      });
      target.addEventListener('drop', event => {
        event.preventDefault();
        target.classList.remove('container-drop-ready');
        const raw =
          event.dataTransfer.getData('application/x-dbo-item') ||
          event.dataTransfer.getData('text/plain');
        if (!raw) return;

        const targetBackdrop = target.closest('.container-window-backdrop');
        const targetContainerId = targetBackdrop?.dataset.containerTargetId;
        if (!targetContainerId) return;

        try {
          const data = JSON.parse(raw);
          if (data.source === 'container' || data.source === 'ground') {
            queueStackMove(data,{kind:'container',targetContainerId});
            return;
          }

          if (data.source === 'equipment') {
            if(data.slot==='backpack'){
              if(targetBackdrop.dataset.containerWindowKind!=='depot'){
                log('A Backpack equipada só pode ser movida inteira para o Depot ou para o chão.');return;
              }
              if(socket.connected){
                socket.sendGameAction('unequip-backpack',{targetContainerId});
                return;
              }
              const result=unequipBackpackToContainer(state,targetContainerId);
              log(result.message);if(!result.ok)return;persist();render();return;
            }
            const result = targetBackdrop.dataset.containerWindowKind === 'depot'
              ? unequipToContainer(state,data.slot,itemCatalog,targetContainerId)
              : unequipToBackpack(state,data.slot,itemCatalog);
            log(result.message);
            if (!result.ok) return;
            persist();
            render();
          }
        } catch {
          log('Não foi possível mover o item entre os containers.');
        }
      });
    });

    root.querySelectorAll('.backpack-summary').forEach(target => {
      target.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
    });


    bindItemTooltipTargets(root);

    root.querySelectorAll('[data-product]').forEach(el => el.addEventListener('click', () => {
      alert('Checkout demonstrativo. A ativação real dependerá do backend e do webhook do provedor.');
    }));
  }

  async function worldTileWalkable(x,y,z){
    await worldMapLoader.loadAround(x,y,z,1);
    const tile=worldMapLoader.cachedTile(x,y,z);
    if(!tile||!Array.isArray(tile.items)||!tile.items.length)return false;
    let hasGround=false;
    for(const raw of tile.items){
      const asset=worldItemRegistry.get(Number(raw[0]||0));
      if(!asset)continue;
      if(asset.isGround)hasGround=true;
      if(asset.isBlocking)return false;
    }
    return hasGround;
  }
  function setGroundDragImage(event, groundId) {
    if (!event?.dataTransfer) return;
    const source = socket.connected ? sharedGroundLoot : state.groundLoot;
    const ground = (source || []).find(entry => String(entry.id) === String(groundId));
    const item = ground ? rarityAdjustedItem(itemCatalog[ground.itemId], ground) : null;
    const ghost = document.createElement('div');
    ghost.className = 'ground-item-drag-ghost';
    ghost.innerHTML = item ? itemVisual(item) : '<span>ITEM</span>';
    document.body.appendChild(ghost);
    // Sem um drag image customizado, Chromium captura o canvas inteiro e a
    // tela parece ser arrastada junto com o loot. Use somente o ícone.
    event.dataTransfer.setDragImage(ghost, 24, 24);
    setTimeout(() => ghost.remove(), 0);
  }

  function mountWorld() {
    const canvas = root.querySelector('#earth-map');
    if (!canvas || !earthMap) return;
    const char = characters[state.profile.characterId];
    mapRenderer = new MapRenderer(canvas, earthMap, {
      regionImage: webRegionImage,
      regionCenter: webRegionCenter,
      worldLoader: worldMapLoader,
      itemRegistry: worldItemRegistry,
      onGroundClick: pickupGroundItem,
      onNpcClick: handleWorldNpcClick,
      onPlayerClick(profileId){
        const target=presence.find(player=>String(player.profileId)===String(profileId));
        if(!target)return;
        playerContextTarget=target;characterProfileOpen=false;characterProfileData=null;tradeMessage='';render();
      },
      npcs: worldNpcs,
      async onMoveRequest(x,y,z,direction){
        if(!await worldTileWalkable(x,y,z)){
          mapRenderer.setPlayer({...state.temple,direction,moving:false});return false;
        }
        if(socket.connected){
          // Predição + reconciliação por sequência. O passo aparece na hora,
          // mas ACKs antigos da VPS não puxam o personagem para trás.
          const moveSeq = ++worldMoveSequence;
          const predicted = {x:Number(x),y:Number(y),z:Number(z),direction:Number(direction??2),moving:true};
          pendingWorldMoves.set(moveSeq,predicted);
          mapRenderer.setPlayer(predicted);
          socket.send({type:'move',x,y,z,direction,moveSeq});
          return true;
        } else{
          state.temple={x,y,z,direction};
          socket.sendPosition(x,y,z,direction);
          if (handleRebornWorldStep(state.temple)) return true;
          if (closeDistanceBoundWorldPanels()) {
            updateCoordinates();
            persist();
            render();
            return true;
          }
          mapRenderer.setPlayer({...state.temple,name:state.profile.name,
            sprite:characterPortrait(char),outfitId:characterOutfitId(char)});
          updateCoordinates();persist();return true;
        }
      }
    });
    mapRenderer.setPlayer({
      ...state.temple,
      name: state.profile.name,
      sprite: characterPortrait(char),
      outfitId: characterOutfitId(char),
      direction: state.temple.direction ?? 2
    });
    mapRenderer.setOthers(worldPresencePlayers());
    mapRenderer.setGroundItems(
      socket.connected ? sharedGroundLoot : state.groundLoot
    );

    // Ground loot is draggable: start the drag only when the mouse is over a
    // rendered item, then a backpack slot can receive it directly.
    let groundDragId=null;
    canvas.addEventListener('mousedown',event=>{
      groundDragId=mapRenderer.groundItemAtClient?.(event.clientX,event.clientY)||null;
      canvas.draggable=Boolean(groundDragId);
    });
    canvas.addEventListener('dragstart',event=>{
      if(!groundDragId){event.preventDefault();return;}
      const payload=JSON.stringify({source:'ground',id:groundDragId});
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('application/x-dbo-item',payload);
      event.dataTransfer.setData('text/plain',payload);
      setGroundDragImage(event, groundDragId);
      root.querySelector('.world-stage')?.classList.add('drag-ground-active');
    });
    canvas.addEventListener('dragend',()=>{groundDragId=null;canvas.draggable=false;root.querySelector('.world-stage')?.classList.remove('drag-ground-active');});

    canvas.addEventListener('dragover', event => {
      const types = [...event.dataTransfer.types];
      if (
        types.includes('application/x-dbo-item') ||
        types.includes('text/plain')
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }
    });
    canvas.addEventListener('drop', event => {
      event.preventDefault();
      const raw =
        event.dataTransfer.getData('application/x-dbo-item') ||
        event.dataTransfer.getData('text/plain');
      root.querySelector('.world-stage')
        ?.classList.remove('drag-item-active');
      if (!raw) return;
      try {
        const data=JSON.parse(raw);
        const target=mapRenderer?.tileAtClient?.(event.clientX,event.clientY)||{...state.temple};
        if(data.source==='container'||data.source==='equipment')queueStackMove(data,{kind:'ground',target});
      } catch {
        log('Não foi possível jogar o item no chão.');
      }
    });
  }


  function mountTrainingArena() {
    const canvas = root.querySelector('#training-canvas');
    if (!canvas) return;
    const char = characters[state.profile.characterId];
    const image = new Image();
    image.src = `${characterPortrait(char)}?v=2058`;
    const punchingBagImage = new Image();
    punchingBagImage.src =
      './generated/web/absolute-monsters/463.webp?v=1225';

    trainingRenderer = new TrainingRenderer(canvas, {
      getState:training.snapshot,
      getRoom:training.currentRoom,
      playerImage:image,
      punchingBagImage,
      // V22.3 — a Sala do Tempo desenha o personagem com a spritesheet
      // direcional do outfit, a mesma que o mapa do Templo usa.
      outfitId:characterOutfitId(char),
      playerName:state.profile?.name || 'Você',
      getAgility:() => Number(state.skills?.agility?.level || 1),
      // 0 na forma base, 1 na última da cadeia — define a aura de ki.
      getFormTier:() => {
        const current=characters[state.profile.characterId];
        const form=currentTransformationForm(state,current);
        if(Number.isFinite(Number(form?.powerStep))) {
          return Math.max(0,Math.min(1,Number(form.powerStep)/13));
        }
        const forms=current?.forms||[];
        if(forms.length<2)return 0;
        const index=forms.findIndex(entry=>entry.id===form?.id);
        return index<=0?0:index/(forms.length-1);
      }
    });
  }

  function mountHuntArena() {
    const canvas = root.querySelector('#hunt-arena-canvas');
    if (!canvas) return;
    canvas.addEventListener('dragover', event => {
      const types = [...event.dataTransfer.types];
      if (
        types.includes('application/x-dbo-item') ||
        types.includes('text/plain')
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }
    });
    canvas.addEventListener('drop', event => {
      event.preventDefault();
      const raw =
        event.dataTransfer.getData('application/x-dbo-item') ||
        event.dataTransfer.getData('text/plain');
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        if (data.source === 'equipment') {
          const itemId = state.equipment[data.slot];
          if (!itemId || data.slot === 'backpack') { if(data.slot==='backpack')log('Para trocar a mochila, arraste a nova Backpack para o slot de Mochila. A mochila atual será preservada dentro da nova.'); return;}
          state.equipment[data.slot] = null;
          hunt.dropItemOnHunt(itemId, 1);
        } else if (data.source === 'container') {
          const removed = removeEntryAt(
            state,
            data.containerId,
            data.index
          );
          if (!removed || removed.containerId) return;
          hunt.dropItemOnHunt(removed.itemId, removed.quantity);
        }
        persist();
        render();
      } catch {
        log('Não foi possível jogar o item no chão da Hunt.');
      }
    });

    huntRenderer = new HuntArenaRenderer(canvas, {
      state,
      characters,
      zones,
      getEnemies: hunt.currentEnemies,
      getEffects: hunt.currentEffects,
      getCorpses: hunt.currentCorpses,
      onCorpseClick: hunt.lootCorpse,
      getCombatStats: hunt.combatStats,
      getRemotePlayers:()=>guildBossArenaParticipants.filter(p=>String(p.profileId)!==String(state.profile.id)),
      onTargetUpdate:updateHuntTargetBar
    });
  }



  function dragSourceInfo(data){
    if(data?.source==='container'){
      const found=findEntryByLocation(state,data.containerId,data.index);
      if(!found)return null;
      return {itemId:found.entry.itemId,quantity:Number(found.entry.quantity||1),entry:found.entry,item:itemCatalog[found.entry.itemId]};
    }
    if(data?.source==='ground'){
      const source=socket.connected?sharedGroundLoot:state.groundLoot;
      const entry=(source||[]).find(row=>String(row.id)===String(data.id));
      return entry?{itemId:entry.itemId,quantity:Number(entry.quantity||1),entry,item:itemCatalog[entry.itemId]}:null;
    }
    if(data?.source==='equipment'){
      const itemId=state.equipment?.[data.slot];
      return itemId?{itemId,quantity:1,entry:state.equipmentMeta?.[data.slot]||{},item:itemCatalog[itemId]}:null;
    }
    return null;
  }

  function queueStackMove(data,operation){
    const info=dragSourceInfo(data);
    if(!info)return;
    const max=Math.max(1,Math.trunc(Number(info.quantity||1)));
    if(info.item?.stackable===true && info.item?.type!=='backpack' && max>1){
      stackMoveDialog={data:{...data},operation:{...operation},max,itemId:info.itemId,quantity:max};
      render();return;
    }
    executeStackMove(data,operation,max);
  }

  function executeStackMove(data,operation,quantity){
    quantity=Math.max(1,Math.trunc(Number(quantity)||1));
    if(operation.kind==='slot'){
      if(data.source==='ground'){pickupGroundItem(data.id,operation.targetContainerId,quantity);return;}
      if(data.source!=='container')return;
      const result=moveEntryToSlot(state,data.containerId,data.index,operation.targetContainerId,Number(operation.targetSlot),itemCatalog,quantity);
      if(!result.ok){
        log(result.reason==='layout-locked'?'A organização desta backpack está travada.':result.reason==='container-cycle'?'Uma backpack não pode ser colocada dentro dela mesma.':result.reason==='partial-swap'?'Para dividir uma pilha, escolha um slot vazio ou outra pilha do mesmo item.':'Não foi possível mover o item para este slot.');return;
      }
      persist();render();return;
    }
    if(operation.kind==='container'){
      if(data.source==='ground'){pickupGroundItem(data.id,operation.targetContainerId,quantity);return;}
      if(data.source!=='container')return;
      const result=moveEntryBetweenContainers(state,data.containerId,data.index,operation.targetContainerId,itemCatalog,quantity);
      if(!result.ok){
        if(result.reason==='same-container')return;
        log(result.reason==='container-cycle'?'Uma backpack não pode ser colocada dentro dela mesma.':result.reason==='full'?'O container de destino está cheio.':'Não foi possível mover o item para esse container.');return;
      }
      persist();render();return;
    }
    if(operation.kind==='ground'){
      dropDraggedItem(data,operation.target,quantity);
    }
  }

  function groundPayload(itemId, quantity = 1, meta = null, source = null) {
    const item = itemCatalog[itemId];
    const displayItem = rarityAdjustedItem(item,meta);
    return {
      itemId,
      quantity,
      name:displayItem?.name || item?.name || itemId,
      serverId:item?.serverId || null,
      icon:item?.icon || 'IT',
      ...(meta?.containerId?{containerId:meta.containerId}:{}),
      ...(meta?.containerTree?{containerTree:meta.containerTree}:{}),
      ...(meta?.instanceId?{instanceId:meta.instanceId,rarity:meta.rarity||'common',rarityTier:Number(meta.rarityTier||0),rarityMultiplier:Number(meta.rarityMultiplier||1),source:meta.source||'ground-drop'}:{}),
      ...(source?.containerId!=null?{sourceContainerId:String(source.containerId),sourceIndex:Number(source.index)}:{})
    };
  }

  async function worldDropLineClearClient(target){
    if(!target||Number(target.z)!==Number(state.temple.z))return false;
    let x=Math.trunc(Number(state.temple.x)),y=Math.trunc(Number(state.temple.y));
    const x1=Math.trunc(Number(target.x)),y1=Math.trunc(Number(target.y));
    if(Math.max(Math.abs(x1-x),Math.abs(y1-y))>14)return false;
    const dx=Math.abs(x1-x),sx=x<x1?1:-1,dy=-Math.abs(y1-y),sy=y<y1?1:-1;let err=dx+dy;
    while(!(x===x1&&y===y1)){
      const e2=2*err;if(e2>=dy){err+=dy;x+=sx}if(e2<=dx){err+=dx;y+=sy}
      if(!await worldTileWalkable(x,y,target.z))return false;
    }
    return true;
  }

  function publishGroundItem(payload,target) {
    const position=target||state.temple;
    const outgoing={...payload,x:Number(position.x),y:Number(position.y),z:Number(position.z)};
    if (socket.connected) {
      delete outgoing.containerTree;
      socket.dropGround(outgoing);
    } else {
      state.groundLoot ||= [];
      state.groundLoot.push({
        id:crypto.randomUUID?.() || `ground-${Date.now()}`,
        ...outgoing,
        droppedBy:state.profile.name,
        droppedAt:Date.now(),
        expiresAt:Date.now() + 60_000
      });
      sharedGroundLoot = state.groundLoot;
      mapRenderer?.setGroundItems(state.groundLoot);
    }
  }

  async function dropDraggedItem(data,target=null,quantity=null) {
    if (activeView !== 'world') {log('Itens só podem ser jogados no chão do PZ.');return;}
    target=target||state.temple;
    if(!await worldDropLineClearClient(target)){log('Não é possível jogar o item nesse SQM: existe parede ou obstáculo no caminho.');return;}

    if (data.source === 'equipment') {
      const slot = data.slot;
      if(slot==='backpack'){
        const rootId=String(state.equipment?.backpack||'');
        const backpack=state.containers?.[rootId];
        if(!backpack){log('O slot de Backpack está vazio.');return;}
        const itemId=backpack.itemId,meta=state.equipmentMeta?.backpack||null;
        if(socket.connected){
          publishGroundItem(groundPayload(itemId,1,{...(meta||{}),containerId:rootId}),target);
          return;
        }
        const tree=extractContainerTree(state,rootId);
        if(!tree){log('Não foi possível preservar o conteúdo desta Backpack.');return;}
        state.equipment.backpack=null;if(state.equipmentMeta)delete state.equipmentMeta.backpack;
        publishGroundItem(groundPayload(itemId,1,{...(meta||{}),containerId:rootId,containerTree:tree}),target);
        log(`${itemCatalog[itemId]?.name || itemId} foi jogada no chão com todo o conteúdo.`);persist();render();return;
      }
      const itemId = state.equipment[slot];
      if (!itemId) return;
      const meta=state.equipmentMeta?.[slot] || null;
      if(socket.connected){publishGroundItem(groundPayload(itemId,1,meta),target);return;}
      state.equipment[slot] = null;if(state.equipmentMeta)delete state.equipmentMeta[slot];
      publishGroundItem(groundPayload(itemId, 1, meta),target);
      log(`${itemCatalog[itemId]?.name || itemId} foi jogado no chão.`);persist();render();return;
    }

    if (data.source === 'container') {
      const found=findEntryByLocation(state,data.containerId,data.index);if(!found)return;
      const available=Math.max(1,Number(found.entry.quantity||1));
      const qty=Math.max(1,Math.min(available,Math.trunc(Number(quantity)||available)));
      if(socket.connected){
        const meta=found.entry;
        publishGroundItem(groundPayload(meta.itemId,qty,meta,{containerId:data.containerId,index:data.index}),target);
        return;
      }
      const removed = removeEntryAt(state,data.containerId,data.index,qty);if (!removed) return;
      if (removed.containerId) {
        const tree=extractContainerTree(state,removed.containerId);
        if(!tree){restoreEntryAt(state,data.containerId,data.index,removed);log('Não foi possível preservar o conteúdo desta backpack.');return;}
        removed.containerTree=tree;
      }
      publishGroundItem(groundPayload(removed.itemId,removed.quantity,removed),target);
      log(`${itemCatalog[removed.itemId]?.name || removed.itemId} foi jogado no chão.`);persist();render();
    }
  }

  function pickupGroundItem(id,preferredContainerId=null,quantity=null) {
    const items = socket.connected ? sharedGroundLoot : state.groundLoot;
    const item = items.find(entry => entry.id === id);
    if (!item || pendingGroundPickupId) return;
    const requested=Math.max(1,Math.min(Number(item.quantity||1),Math.trunc(Number(quantity)||Number(item.quantity||1))));

    const restoringMainBackpack = Boolean(item.containerTree && !state.equipment?.backpack);
    if (!restoringMainBackpack && !canAcceptItem(state,item.itemId,requested,itemCatalog)) {log('Backpack cheia. Libere um slot para pegar o item.');return;}
    const distance = Math.abs(item.x-state.temple.x)+Math.abs(item.y-state.temple.y);
    if (item.z !== state.temple.z || distance > 2) {log('Chegue mais perto para pegar o item.');return;}

    if (socket.connected) {
      pendingGroundPickupId = id;
      socket.pickupGround(id,preferredContainerId,requested);
      return;
    }
    if(item.containerTree && requested!==Number(item.quantity||1)){log('Backpacks no chão são recolhidas inteiras.');return;}
    const result = item.containerTree
      ? restoreContainerTree(state,item.containerTree,itemCatalog,preferredContainerId)
      : addItemToInventory(state,item.itemId,requested,itemCatalog,preferredContainerId,item.instanceId ? item : null);
    if (!result.ok) {log('Backpack cheia.');return;}
    if(requested>=Number(item.quantity||1))state.groundLoot=state.groundLoot.filter(entry=>entry.id!==id);
    else item.quantity=Number(item.quantity||1)-requested;
    sharedGroundLoot = state.groundLoot;mapRenderer?.setGroundItems(state.groundLoot);
    log(`${item.name || item.itemId} foi recolhido.`);persist();updateDynamicPanels();
  }

  function useQuickConsumable(itemId) {
    const item = itemCatalog[itemId];
    if (!item || itemQuantity(state, itemId) <= 0) {
      log('Você não possui esse consumível.');
      return;
    }

    const result = hunt.useConsumable(itemId);
    if (!result.ok) {
      if (result.reason === 'full') {
        log(`${item.name} não foi usado porque HP e Ki já estão cheios.`);
      } else if(result.reason === 'cooldown'){
        log(`${item.name}: aguarde o cooldown de 1 segundo.`);
      } else {
        log(`${item.name} não pôde ser utilizado.`);
      }
      updateDynamicPanels();
      return;
    }

    log(
      `${item.name} utilizado`
      + `${result.hpRecovered ? ` · +${Math.ceil(result.hpRecovered)} HP` : ''}`
      + `${result.kiRecovered ? ` · +${Math.ceil(result.kiRecovered)} Ki` : ''}.`
    );
    persist();
    updateDynamicPanels();
  }

  function useItem(itemId, instanceId = null) {
    const item = itemCatalog[itemId];
    if (!item) return;
    if (item.type === 'consumable') {
      log(`${item.name} está reservado para uso durante combate.`);
      return;
    }
    let targetSlot = null;
    if (
      item.trainingSkill === 'attackSpeed' &&
      state.equipment.weapon === item.id &&
      state.equipment.offhand !== item.id
    ) {
      targetSlot = 'offhand';
    }
    if (socket.connected) {
      socket.sendGameAction('equip-item', {
        itemId:item.id,
        instanceId,
        slot:targetSlot
      });
      return;
    }
    const result = equip(state, item, itemCatalog, targetSlot, instanceId);
    log(result.message);
    persist();
    render();
  }

  function renderChatOnly() {
    const box = root.querySelector('#chat-messages');
    if (!box) return;
    const messages=state.chat.filter(message => {
      if(activeChatTab==='loot') return message.channel==='loot';
      if(activeChatTab==='server') return message.channel==='server' || (Boolean(message.system) && message.channel!=='loot');
      return !message.system && (message.channel==null || message.channel==='default');
    });
    const emptyLabel=activeChatTab==='loot'?'Nenhum loot registrado nesta sessao.':activeChatTab==='server'?'Nenhuma mensagem do servidor.':'Nenhuma mensagem de jogador.';
    box.innerHTML = messages.length
      ? messages.map(m => `<div class="${m.system ? 'system' : ''} ${m.channel==='loot'?'loot-message':''}"><time>${formatTime(m.at)}</time><strong>${escapeHtml(m.author)}:</strong><span>${escapeHtml(m.text)}</span></div>`).join('')
      : `<div class="system"><span>${emptyLabel}</span></div>`;
    scrollChat();
  }

  function expireLocalGroundLoot() {
    const now = Date.now();
    state.groundLoot ||= [];
    const before = state.groundLoot.length;
    state.groundLoot = state.groundLoot.filter(item =>
      (item.expiresAt || item.droppedAt + 60_000) > now
    );
    if (before !== state.groundLoot.length) {
      sharedGroundLoot = state.groundLoot;
      mapRenderer?.setGroundItems(state.groundLoot);
    }
  }


  function updateSpellCooldowns() {
    root.querySelectorAll('[data-spell-cooldown]').forEach(overlay => {
      const spellId = overlay.dataset.spellCooldown;
      const remainingMs=spellController.cooldownRemaining(spellId);
      const button = overlay.closest('.spell-cast-button, .support-spell-button');

      if (remainingMs <= 0) {
        overlay.hidden = true;
        overlay.textContent = '';
        button?.classList.remove('on-cooldown');
        return;
      }

      overlay.hidden = false;
      overlay.textContent = remainingMs >= 10_000
        ? `${Math.ceil(remainingMs / 1000)}s`
        : `${(remainingMs / 1000).toFixed(1)}s`;
      button?.classList.add('on-cooldown');
    });
    root.querySelectorAll('[data-pvp-spell-cooldown]').forEach(overlay=>{
      const spellId=overlay.dataset.pvpSpellCooldown;
      const remaining=pvpCooldownRemaining(spellId);
      const button=overlay.closest('.pvp-spell-slot');
      overlay.hidden=remaining<=0;
      overlay.textContent=remaining>0?(remaining>=10000?`${Math.ceil(remaining/1000)}s`:`${(remaining/1000).toFixed(1)}s`):'';
      button?.classList.toggle('on-cooldown',remaining>0);
    });
    const basicCooldown=root.querySelector('[data-pvp-basic-cooldown]');
    if(basicCooldown){
      const remaining=pvpBasicAttackRemaining();
      const button=basicCooldown.closest('.pvp-basic-attack');
      basicCooldown.hidden=remaining<=0;
      basicCooldown.textContent=remaining>0?(remaining>=10000?`${Math.ceil(remaining/1000)}s`:`${(remaining/1000).toFixed(1)}s`):'';
      button?.classList.toggle('on-cooldown',remaining>0);
    }
    const pvpCountdown=root.querySelector('[data-pvp-countdown]');
    if(pvpCountdown){
      const remaining=Math.max(0,Math.ceil((Number(pvpState?.startsAt||0)-Date.now())/1000));
      pvpCountdown.textContent=String(remaining);
      if(remaining<=0)pvpCountdown.closest('.pvp-countdown')?.remove();
    }
    root.querySelectorAll('[data-senzu-cooldown]').forEach(overlay=>{
      const remaining=Math.max(0,Number(hunt.consumableCooldownRemaining?.('senzu')||state.hunt?.senzuCooldownUntil-Date.now()||0));
      overlay.hidden=remaining<=0;overlay.textContent=remaining>0?`${(remaining/1000).toFixed(1)}s`:'';
      overlay.closest('.combat-slot')?.classList.toggle('on-cooldown',remaining>0);
    });
    const questRemaining=progressionQuestRemainingMs(state);
    root.querySelectorAll('[data-quest-countdown]').forEach(el=>el.textContent=formatQuestCountdown(questRemaining));
    root.querySelectorAll('[data-boss-countdown]').forEach(el=>{const zone=zones.find(z=>z.id===state.hunt?.zoneId),remaining=zone?.guildBoss?Math.max(0,guildBossFightDeadlineAt-Date.now()):Math.max(0,Number(state.hunt?.bossDeadlineAt||0)-Date.now());el.textContent=formatQuestCountdown(remaining);});
    root.querySelectorAll('[data-status-boost]').forEach(el=>{const kind=el.dataset.statusBoost,until=Number(state.profile[kind==='loot'?'lootBoostUntil':'xpBoostUntil']||0),label=el.querySelector('em');if(label)label.textContent=formatBoostRemaining(until);el.hidden=until<=Date.now();});
    root.querySelectorAll('[data-mail-expiry]').forEach(el=>{const expiresAt=Number(el.dataset.mailExpiresAt||0),mail=ensureMailbox(state.profile).find(row=>String(row.id)===String(el.dataset.mailExpiry));if(!mail){el.closest('[data-mail-id]')?.remove();return;}el.textContent=mailRemainingLabel(mail,Date.now());if(expiresAt&&expiresAt<=Date.now())el.closest('[data-mail-id]')?.remove();});
    if(progressionQuestExpired(state)&&!socket.connected)expireLocalProgressionQuest();
  }

  function refreshOpenContainerWindows() {
    root.querySelectorAll('.container-window-backdrop').forEach(backdrop => {
      const containerId = backdrop.dataset.containerTargetId;
      const container = openContainer(state, containerId);
      if (!container) return;
      const signature = JSON.stringify(container.items || []);
      if (backdrop.dataset.containerSignature === signature) return;

      const grid = backdrop.querySelector('.classic-container-grid');
      if (!grid) return;
      const slots = containerSlots(container);
      root.querySelector('#item-tooltip')?.classList.remove('visible');
      grid.innerHTML = slots.map((slot,uiSlot) => slot
        ? renderContainerItem(slot.entry,container.id,slot.index,uiSlot,container.layoutLocked)
        : `<div class="classic-item empty container-slot-target" data-container-slot="${uiSlot}" data-container-slot-container="${container.id}"><small>${uiSlot + 1}</small></div>`
      ).join('');
      backdrop.dataset.containerSignature = signature;
      bindItemTooltipTargets(grid);

      // Bind only the new slot nodes. The container window itself is retained,
      // so its drag/drop and position handlers do not get duplicated.
      grid.querySelectorAll('[data-item]').forEach(el =>
        el.addEventListener('click', () => useItem(el.dataset.item,el.dataset.instanceId||null))
      );
      grid.querySelectorAll('[data-open-container]').forEach(element =>
        element.addEventListener('click', event => {
          event.stopPropagation();
          const id = element.dataset.openContainer;
          if (!id) return;
          const path = containerPath(state,id);
          const rootContainer = path[0] || openContainer(state,id);
          if (rootContainer?.id === state.depotContainerId) openDepotContainerId = id;
          else if (!openContainerIds.includes(id)) openContainerIds.push(id);
          render();
        })
      );
      grid.querySelectorAll('[data-drag-container]').forEach(element => {
        element.addEventListener('dragstart', event => {
          const sourceContainer=state.containers?.[element.dataset.dragContainer];
          if(sourceContainer?.layoutLocked){event.preventDefault();log('A organização desta backpack está travada.');return;}
          event.dataTransfer.effectAllowed = 'move';
          const payload = JSON.stringify({
            source:'container',
            containerId:element.dataset.dragContainer,
            index:Number(element.dataset.dragIndex)
          });
          event.dataTransfer.setData('application/x-dbo-item',payload);
          event.dataTransfer.setData('text/plain',payload);
          root.querySelector('.world-stage')?.classList.add('drag-item-active');
        });
        element.addEventListener('dragend', () =>
          root.querySelector('.world-stage')?.classList.remove('drag-item-active')
        );
      });
      grid.querySelectorAll('[data-container-slot]').forEach(target => {
        if(target.dataset.nestedContainerTarget)return;
        target.addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';target.classList.add('container-slot-ready');});
        target.addEventListener('dragleave',()=>target.classList.remove('container-slot-ready'));
        target.addEventListener('drop',event=>{
          event.preventDefault();event.stopPropagation();target.classList.remove('container-slot-ready');
          const raw=event.dataTransfer.getData('application/x-dbo-item')||event.dataTransfer.getData('text/plain');if(!raw)return;
          try{
            const data=JSON.parse(raw);
            if(data.source==='equipment'&&data.slot==='backpack'){
              const backdrop=target.closest('.container-window-backdrop');
              const targetContainerId=target.dataset.containerSlotContainer;
              if(backdrop?.dataset.containerWindowKind!=='depot'){log('A Backpack equipada só pode ser movida inteira para o Depot ou para o chão.');return;}
              if(socket.connected){socket.sendGameAction('unequip-backpack',{targetContainerId});return;}
              const result=unequipBackpackToContainer(state,targetContainerId);log(result.message);if(result.ok){persist();refreshOpenContainerWindows();}return;
            }
            if(data.source==='ground'||data.source==='container'){
              queueStackMove(data,{kind:'slot',targetContainerId:target.dataset.containerSlotContainer,targetSlot:Number(target.dataset.containerSlot)});
              return;
            }
          }catch{log('Não foi possível reorganizar este slot.');}
        });
      });
      grid.querySelectorAll('[data-nested-container-target]').forEach(target => {
        target.addEventListener('dragover', event => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect='move';
          target.classList.add('container-drop-ready');
        });
        target.addEventListener('dragleave', () => target.classList.remove('container-drop-ready'));
        target.addEventListener('drop', event => {
          event.preventDefault();
          event.stopPropagation();
          target.classList.remove('container-drop-ready');
          const raw=event.dataTransfer.getData('application/x-dbo-item') || event.dataTransfer.getData('text/plain');
          if(!raw)return;
          try{
            const data=JSON.parse(raw);
            if(data.source==='equipment'&&data.slot==='backpack'){
              const targetId=target.dataset.nestedContainerTarget,targetContainer=state.containers?.[targetId],parent=state.containers?.[targetContainer?.parentId];
              const index=(parent?.items||[]).findIndex(entry=>String(entry.containerId||'')===String(targetId));
              if(!targetContainer||!parent||index<0){log('Não foi possível localizar a Backpack de destino.');return;}
              const entry=parent.items[index];
              if(socket.connected)socket.sendGameAction('equip-item',{itemId:entry.itemId,instanceId:entry.instanceId||null,slot:'backpack'});
              else{const swapped=equipFromContainer(state,parent.id,index,itemCatalog,'backpack');log(swapped.message);if(swapped.ok){persist();refreshOpenContainerWindows();}}
              return;
            }
            if(data.source==='ground'||data.source==='container'){
              queueStackMove(data,{kind:'container',targetContainerId:target.dataset.nestedContainerTarget});
              return;
            }
          }catch{log('Não foi possível mover a backpack.');}
        });
      });
    });
  }

  function updateDynamicPanels({containersChanged=false}={}) {
    expireLocalGroundLoot();
    const char = characters[state.profile.characterId];
    const stats = totalStats(state, itemCatalog);
    const resources = maxResources(state, char, stats);
    const maxHp = Math.max(1, Number(resources.maxHp || 1));
    const maxKi = Math.max(1, Number(resources.maxKi || 1));

    state.profile.maxHp = maxHp;
    state.profile.maxKi = maxKi;

    const hp = Math.min(
      maxHp,
      Math.max(
        0,
        Number(
          state.hunt.running
            ? state.hunt.playerHp ?? state.profile.hp ?? maxHp
            : state.profile.hp ?? maxHp
        )
      )
    );
    const currentKi = Math.min(
      maxKi,
      Math.max(0, Number(state.profile.ki ?? maxKi))
    );

    const hpBar = root.querySelector('.status-box .classic-bar.hp i');
    const kiBar = root.querySelector('.status-box .classic-bar.ki i');
    const hpText = root.querySelector('.status-box .classic-bar.hp span');
    const kiText = root.querySelector('.status-box .classic-bar.ki span');

    if (hpBar) hpBar.style.width = `${Math.min(100, hp / maxHp * 100)}%`;
    if (kiBar) kiBar.style.width = `${Math.min(100, currentKi / maxKi * 100)}%`;
    if (hpText) hpText.textContent =
      `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
    if (kiText) kiText.textContent =
      `${Math.ceil(currentKi)} / ${Math.ceil(maxKi)}`;

    const level = root.querySelector('.portrait-row small');
    if (level) {
      const next = nextTransformation(char);
      level.innerHTML =
        `${escapeHtml(char.name)} · Level ${state.profile.level}` +
        (next
          ? next.available
            ? ` <button class="transform-button"
                  data-action="transform-character"
                  title="Vocação ${next.toVocation} · lookType ${next.lookType}">
                  Transformar
                </button>`
            : ` <span class="transform-requirement">
                  Próxima transformação: Lv ${next.requiredLevel}
                </span>`
          : '');
    }
    bindTransformButton();
    const portrait = root.querySelector('.portrait-row .portrait img');
    if (portrait) {
      const nextSrc=`${characterPortrait(char)}?v=2058`;
      if(!portrait.src.endsWith(nextSrc.replace(/^\.\//,'')) && portrait.getAttribute('src')!==nextSrc){
        portrait.classList.add('sprite-pending');
        portrait.onload=()=>portrait.classList.remove('sprite-pending');
        portrait.src=nextSrc;
      }
    }
    const progressionScroll =
      root.querySelector('.progression-scroll');
    if (progressionScroll && progressionOpen) {
      const progressionScrollTop = progressionScroll.scrollTop;
      progressionScroll.innerHTML=renderProgressionContents();
      progressionScroll.scrollTop = progressionScrollTop;
    }
    const xpProgress = characterXpProgress(state.profile);
    const xpBar = root.querySelector('.status-box .classic-bar.xp i');
    const xpText = root.querySelector('.status-box .classic-bar.xp span');
    if (xpBar) xpBar.style.width = `${xpProgress.percentage}%`;
    if (xpText) xpText.textContent = `${xpProgress.percentage.toFixed(1)}%`;
    const statusCells = root.querySelectorAll('.status-grid span');
    if (statusCells[2]) statusCells[2].textContent = `🏦 ${state.profile.bank || 0}`;
    const backpack = equippedBackpack(state);
    const backpackCount = root.querySelector('[data-backpack-count]');
    if (backpackCount && backpack) {
      backpackCount.textContent =
        `${usedSlots(backpack)}/${backpack.capacity}`;
    }
    if (containersChanged) refreshOpenContainerWindows();
    root.querySelectorAll('[data-npc-owned-count]').forEach(element => {
      element.textContent = `Possui: ${itemQuantity(state,element.dataset.npcOwnedCount).toLocaleString('pt-BR')}`;
    });
    root.querySelectorAll('[data-quick-count]').forEach(element => {
      element.textContent = itemQuantity(state, element.dataset.quickCount);
    });
    root.querySelectorAll('[data-entry-quantity]').forEach(element => {
      const [containerId,index] = String(element.dataset.entryQuantity || '').split(':');
      const found = findEntryByLocation(state, containerId, Number(index));
      const quantity = Number(found?.entry?.quantity || 0);
      element.textContent = quantity > 1 ? quantity : '';
    });
    root.querySelectorAll('.container-window-backdrop').forEach(backdrop => {
      const containerId = backdrop.dataset.containerTargetId;
      const container = openContainer(state, containerId);
      const count = backdrop.querySelector('.container-window header small');
      if (container && count) {
        count.textContent = `${usedSlots(container)}/${container.capacity} slots`;
      }
    });
    renderChatOnly();
    updateSpellCooldowns();
    updateHuntAnalyserPanel();
  }

  function updateOnline() {
    const el = root.querySelector('#online-count');
    if (el) el.textContent = `${presence.length + 1} jogador(es)`;
    const status = root.querySelector('#connection-status');
    if (status) {
      status.textContent = networkStatus === 'online' ? 'Online' : networkStatus === 'reconnecting' ? 'Reconectando...' : 'Offline';
      status.className = networkStatus;
    }
  }

  function updateCoordinates() {}

  function scrollChat() {
    const messages = root.querySelector('#chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
  }


  function itemStatRows(item) {
    const stats = item.stats || {};
    const displayStats = {...stats};
    const bodySlots = new Set(['helmet','armor','legs','boots']);
    const bodyItem = bodySlots.has(String(item?.type||'')) || bodySlots.has(String(item?.slot||''));
    // Corpo usa uma única leitura defensiva. Se a fonte trouxe apenas
    // `defense`, ela é apresentada como Armadura; nunca mostramos Armadura e
    // Defesa como se fossem dois atributos diferentes no mesmo item corporal.
    if(bodyItem){
      if(!Number(displayStats.armor||0) && Number(displayStats.defense||0))displayStats.armor=displayStats.defense;
      displayStats.defense=0;
    }
    const rows = [];

    // A tooltip always follows this order. Internal timing values such as
    // Internal regeneration timing fields are intentionally hidden.
    const orderedStats = [
      ['armor', 'Armadura'],
      ['attack', 'Ataque'],
      ['defense', 'Defesa'],
      ['extraDefense', 'Defesa extra'],
      ['hp', 'HP máximo'],
      ['ki', 'Ki máximo'],
      ['hpRegenPerSecond', 'Regeneração de HP/s'],
      ['kiRegenPerSecond', 'Regeneração de Ki/s'],
      ['speed', 'Velocidade'],
      ['attackSpeed', 'Velocidade de ataque'],
      ['range', 'Alcance'],
      ['critical', 'Chance crítica'],
      ['criticalDamage', 'Dano crítico'],
      ['physicalResistance', 'Resistência física'],
      ['kiResistance', 'Resistência de Ki'],
      ['allResistance', 'Resistência geral'],
      ['fireResistance', 'Resistência a fogo'],
      ['earthResistance', 'Resistência a terra'],
      ['iceResistance', 'Resistência a gelo'],
      ['holyResistance', 'Resistência sagrada'],
      ['deathResistance', 'Resistência à morte'],
      ['capacity', 'Espaços'],
      ['charges', 'Cargas']
    ];

    for (const [key, label] of orderedStats) {
      const value = Number(displayStats[key] || 0);
      if (!Number.isFinite(value) || value === 0) continue;
      const displayValue = Math.round(value);
      rows.push({
        key,
        label,
        value:displayValue > 0 ? `+${displayValue}` : String(displayValue),
        positive:value >= 0
      });
    }

    const skillOrder = [
      ['gloves', 'Strength'],
      ['strength', 'Strength'],
      ['kiBlasting', 'Ki Blasting'],
      ['kiLevel', 'Ki Level'],
      ['attackSpeed', 'Atk Speed'],
      ['critical', 'Critical'],
      ['agility', 'Agility'],
      ['defense', 'Defense'],
      ['defenseSkill', 'Defense'],
      ['barrier', 'Barrier']
    ];
    const bonuses = stats.skillBonuses || {};
    const shownSkills = new Set();

    for (const [skillId, label] of skillOrder) {
      if (bodyItem && (skillId === 'defense' || skillId === 'defenseSkill')) continue;
      const value = Number(bonuses[skillId] || 0);
      if (!value || shownSkills.has(label)) continue;
      const displayValue = Math.round(value);
      shownSkills.add(label);
      rows.push({
        key:`skill-${skillId}`,
        label,
        value:displayValue > 0 ? `+${displayValue}` : String(displayValue),
        positive:value >= 0
      });
    }

    if (item.restoreHp) {
      const displayValue = Math.round(Number(item.restoreHp || 0));
      rows.push({
        key:'restoreHp',
        label:'Recupera HP',
        value:`+${displayValue}`,
        positive:true
      });
    }
    if (item.restoreKi) {
      const displayValue = Math.round(Number(item.restoreKi || 0));
      rows.push({
        key:'restoreKi',
        label:'Recupera Ki',
        value:`+${displayValue}`,
        positive:true
      });
    }
    if (item.restoreFullHp) {
      rows.push({
        key:'restoreFullHp',
        label:'HP',
        value:'Recuperação total',
        positive:true
      });
    }
    if (item.restoreFullKi) {
      rows.push({
        key:'restoreFullKi',
        label:'Ki',
        value:'Recuperação total',
        positive:true
      });
    }

    return rows;
  }

  function itemDetails(item) {
    return [
      item.name,
      ...itemStatRows(item).map(row => `${row.label}: ${row.value}`)
    ].filter(Boolean).join('\n');
  }

  function itemTooltipHtml(item, slot = '') {
    const rows = itemStatRows(item);
    const rarityName = isRarityEligibleItem(item)
      ? rarityDefinition(item.rarity).name
      : ({training:'Treino'}[item.rarity] || 'Comum');

    const typeName = {
      helmet:'Capacete',
      necklace:'Amuleto',
      backpack:'Backpack',
      armor:'Armadura',
      weapon:'Arma',
      legs:'Calças',
      boots:'Botas',
      ring:'Anel',
      ammo:'Munição',
      consumable:'Consumível',
      misc:'Item'
    }[item.type] || item.type || 'Item';

    const slotName = slot ? slotNames[slot] : '';
    return `
      <article class="item-tooltip-card rarity-${item.rarity || 'common'}">
        <header>
          <div class="item-tooltip-icon">${itemVisual(item)}</div>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="item-tooltip-badges">
              <span>${escapeHtml(typeName)}</span>
              <span class="rarity">${escapeHtml(rarityName)}</span>
              ${equipmentRequiredLevel(item)
                ? `<span>Level ${equipmentRequiredLevel(item)}</span>`
                : ''}
            </div>
          </div>
        </header>

        ${isRarityEligibleItem(item) ? `<div class="item-tooltip-rarity-bonus">Bônus de raridade: <strong>+${Math.round((Number(item.rarityMultiplier||1)-1)*100)}%</strong></div>` : ''}
        ${slotName
          ? `<div class="item-tooltip-equipped">
              Equipado em <strong>${escapeHtml(slotName)}</strong>
            </div>`
          : ''}

        ${rows.length
          ? `<section class="item-tooltip-stats">
              ${rows.map(row => `
                <div>
                  <span>${escapeHtml(row.label)}</span>
                  <strong class="${row.positive ? 'positive' : 'negative'}">
                    ${escapeHtml(row.value)}
                  </strong>
                </div>
              `).join('')}
            </section>`
          : `<section class="item-tooltip-empty">
              Este item não possui bônus numéricos.
            </section>`}


        <footer>
          <span>Preço</span>
          <strong>
            ${isNpcSaleBlocked(item)
              ? (item.playerMarketOnly?'Somente Mercado de Players':'Não vendável')
              : `${npcSellUnitPrice(item).toLocaleString('pt-BR')} zenis`}
          </strong>
        </footer>
      </article>
    `;
  }

  function itemVisual(item) {
    const rarityAura = isRarityEligibleItem(item)
      ? rarityDefinition(item?.rarity || 'common').id
      : null;
    const wrapAura = visual => rarityAura
      ? `<span class="item-rarity-aura rarity-${rarityAura}" aria-hidden="true">${visual}</span>`
      : visual;
    const iconIsPath = typeof item?.icon === 'string' && item.icon.includes('/');
    // `generated/web/items/{serverId}.png` only covers ~185 curated items;
    // the full-registry preview referenced by `.icon` covers the other
    // ~12,700. Previously the (usually-missing) serverId path was tried
    // first and, on failure, the code fell back to rendering `.icon` as
    // plain text — for any item where `.icon` was actually a path rather
    // than a short 2-3 letter code, that meant the raw file path showed
    // up as visible text on screen instead of an icon. Try the
    // full-registry path first (it actually exists for these items), the
    // serverId path second, and only fall back to text for items that
    // truly have nothing but a short code.
    const shortCodeFallback = iconIsPath ? 'IT' : (item?.icon || 'IT');
    const primarySrc = iconIsPath ? item.icon : `./generated/web/items/${item?.serverId}.png`;
    const secondarySrc = iconIsPath
      ? (item?.serverId ? `./generated/web/items/${item.serverId}.png` : null)
      : null;

    if (!item?.serverId && !iconIsPath) {
      return wrapAura(`<span class="safe-item-icon">${escapeHtml(shortCodeFallback)}</span>`);
    }

    const fallbackChain = secondarySrc
      ? `this.onerror=function(){this.replaceWith(document.createTextNode('${escapeHtml(shortCodeFallback)}'))};this.onload=function(){this.classList.remove('sprite-pending')};this.src='${secondarySrc}';`
      : `this.replaceWith(document.createTextNode('${escapeHtml(shortCodeFallback)}'))`;

    return wrapAura(`<img class="real-item-sprite sprite-pending" src="${primarySrc}" alt="${escapeHtml(item.name)}" onload="this.classList.remove('sprite-pending')" onerror="${fallbackChain}">`);
  }

  function slotIcon(slot) {
    return ({helmet:'◠',necklace:'◇',backpack:'▣',armor:'▥',weapon:'⚔',offhand:'Ⅱ',legs:'▤',boots:'⌄',ring:'○',ammo:'➤'})[slot] || '·';
  }
  function statName(key) {
    return ({attack:'Ataque',defense:'Defesa',hp:'HP',speed:'Velocidade',crit:'Crítico',dodge:'Esquiva'})[key] || key;
  }
  function formatTime(value) {
    const timestamp=Number(value);
    if(!Number.isFinite(timestamp)||timestamp<=0)return '--:--';
    return new Date(timestamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  }
  function escapeHtml(value='') {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  const progressionQuestKeyHandler = event => {
    if(activeView!=='quest-expedition'||(partyState&&!partyState.isLeader))return;
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    const key=String(event.key||'').toLowerCase();
    const dir=key==='w'||key==='arrowup'?[0,-1]:key==='s'||key==='arrowdown'?[0,1]:key==='a'||key==='arrowleft'?[-1,0]:key==='d'||key==='arrowright'?[1,0]:null;
    if(!dir)return;event.preventDefault();
    if(partyState)socket.sendPartyAction('expedition-move',{dx:dir[0],dy:dir[1]});else if(socket.connected)socket.sendGameAction('progression-quest-move',{dx:dir[0],dy:dir[1]});else localMoveProgressionQuest(dir[0],dir[1]);
  };
  const pvpKeyHandler = event => {
    if(activeView!=='pvp'||!pvpState||Date.now()<Number(pvpState.startsAt||0))return;
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    const key=String(event.key||'').toLowerCase();
    const dir=key==='w'||key==='arrowup'?[0,-1]:key==='s'||key==='arrowdown'?[0,1]:key==='a'||key==='arrowleft'?[-1,0]:key==='d'||key==='arrowright'?[1,0]:null;
    if(!dir)return;event.preventDefault();
    socket.sendPvpAction('move',{dx:dir[0],dy:dir[1]});
  };
  window.addEventListener('keydown',progressionQuestKeyHandler);
  window.addEventListener('keydown',pvpKeyHandler);
  const guildBossCountdownInterval=setInterval(updateGuildBossAcceptedCountdown,250);
  const guildBossTauntCooldownInterval=setInterval(updateGuildBossTauntCooldown,100);
  render();
  window.addEventListener('beforeunload', () => {
    persist();
    window.removeEventListener('keydown',progressionQuestKeyHandler);
    window.removeEventListener('keydown',pvpKeyHandler);
    clearInterval(spellCooldownVisualInterval);
    clearInterval(guildBossCountdownInterval);
    clearInterval(guildBossTauntCooldownInterval);
    mapRenderer?.destroy();
    huntRenderer?.destroy();
    hunt.destroy();
  });
}
