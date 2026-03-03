function registerGameplayRoutes(app, deps) {
    const {
        getGameState,
        setGameState,
        createInitialGameState,
        migrateGameState,
        persistGameState,
        scheduleAutoSave,
        ensurePlayerProgressFields,
        getXpRequiredForLevel,
        validateNumber,
        validateNumericRecord,
        clamp,
        applyEncounterOutcome,
        getGameStateVersion
    } = deps;

    const CHAPPY_STATS = ['charm', 'hardiness', 'agility', 'perception', 'politeness', 'yarns'];
    const FACTION_OPTIONS = ['Plaid Paladins', 'Tidesmen', 'Glo-Riders'];

    function ensureMetaState(gameState) {
        if (!gameState.sessionMetrics) {
            gameState.sessionMetrics = {
                startedAt: new Date().toISOString(),
                questCompletions: { logan: 0, rylyn: 0 },
                scrapGained: { logan: 0, rylyn: 0 },
                funniestRadio: null,
                lastRecap: null
            };
        }

        if (!gameState.playerProgress) {
            gameState.playerProgress = {};
        }

        Object.keys(gameState.players || {}).forEach((playerKey) => {
            if (!gameState.playerProgress[playerKey]) {
                gameState.playerProgress[playerKey] = {};
            }
            const entry = gameState.playerProgress[playerKey];
            if (!Array.isArray(entry.achievements)) entry.achievements = [];
            if (!entry.chainProgress || typeof entry.chainProgress !== 'object') entry.chainProgress = {};
            if (!entry.passiveKey) entry.passiveKey = null;
            if (typeof entry.teamContribution !== 'boolean') entry.teamContribution = false;
            if (!Number.isFinite(entry.teamObjectiveContributions)) entry.teamObjectiveContributions = 0;
        });
    }

    function getDominantStat(playerData) {
        const stats = playerData?.stats || {};
        let bestStat = 'charm';
        let bestValue = -Infinity;
        CHAPPY_STATS.forEach((stat) => {
            const value = Number(stats[stat] || 0);
            if (value > bestValue) {
                bestValue = value;
                bestStat = stat;
            }
        });
        return bestStat;
    }

    function resolvePassiveKey(playerData) {
        const className = String(playerData?.class || '').toLowerCase();
        if (className.includes('scav')) return 'scavenger';
        if (className.includes('vanguard') || className.includes('tank') || className.includes('bruiser')) return 'vanguard';
        if (className.includes('signal') || className.includes('tech') || className.includes('radio')) return 'signaler';
        if (className.includes('diplo') || className.includes('face')) return 'diplomat';

        const dominant = getDominantStat(playerData);
        if (dominant === 'hardiness') return 'vanguard';
        if (dominant === 'perception' || dominant === 'yarns') return 'signaler';
        if (dominant === 'charm' || dominant === 'politeness') return 'diplomat';
        return 'scavenger';
    }

    function syncPlayerPassive(gameState, player) {
        ensureMetaState(gameState);
        const playerData = gameState.players[player];
        if (!playerData) return null;

        const passiveKey = resolvePassiveKey(playerData);
        gameState.playerProgress[player].passiveKey = passiveKey;
        playerData.classPassiveKey = passiveKey;
        playerData.classPassive = gameState.classPassives?.[passiveKey] || null;
        return passiveKey;
    }

    function addXpWithLeveling(playerData, xpAmount) {
        let levelsGained = 0;
        const safeXp = Number(xpAmount || 0);
        if (safeXp <= 0) return levelsGained;

        playerData.level = Math.max(1, Number(playerData.level) || 1);
        playerData.xp = Math.max(0, Number(playerData.xp) || 0) + safeXp;
        let xpNeeded = getXpRequiredForLevel(playerData.level);
        while (playerData.xp >= xpNeeded) {
            playerData.xp -= xpNeeded;
            playerData.level = Number(playerData.level) + 1;
            levelsGained += 1;
            xpNeeded = getXpRequiredForLevel(playerData.level);
        }

        playerData.pendingPerks = (playerData.pendingPerks || 0) + levelsGained;
        ensurePlayerProgressFields(playerData);
        return levelsGained;
    }

    function hasPerk(playerData, perkId) {
        return Boolean(Array.isArray(playerData?.unlockedPerks) && playerData.unlockedPerks.includes(perkId));
    }

    function getActiveEffectModifiers(gameState, playerData) {
        if (!playerData || !Array.isArray(playerData.activeEffects)) {
            return [];
        }

        const effectById = new Map((gameState.statusEffects || []).map((effect) => [effect.id, effect]));
        return playerData.activeEffects
            .map((effectId) => effectById.get(effectId))
            .filter((effect) => effect && effect.modifiers && typeof effect.modifiers === 'object')
            .map((effect) => effect.modifiers);
    }

    function getActiveEffectNumericSum(gameState, playerData, key) {
        return getActiveEffectModifiers(gameState, playerData)
            .reduce((sum, modifiers) => sum + Number(modifiers[key] || 0), 0);
    }

    function getActiveEffectStatCheckBonus(gameState, playerData, statKey) {
        return getActiveEffectModifiers(gameState, playerData).reduce((sum, modifiers) => {
            const statBonus = modifiers.statCheckBonus && typeof modifiers.statCheckBonus === 'object'
                ? Number(modifiers.statCheckBonus[statKey] || 0)
                : 0;
            return sum + statBonus;
        }, 0);
    }

    function applyMissionTabsReward(playerData, baseTabs) {
        const gameState = getGameState();
        const safeBase = Math.max(0, Number(baseTabs || 0));
        if (safeBase <= 0) return 0;

        let totalTabs = safeBase;
        if (hasPerk(playerData, 'p3')) {
            totalTabs += 2;
        }
        if (hasPerk(playerData, 'p14')) {
            totalTabs += Math.ceil(safeBase * 0.10);
        }

        totalTabs += getActiveEffectNumericSum(gameState, playerData, 'missionTabsBonus');
        const missionTabsPercent = getActiveEffectNumericSum(gameState, playerData, 'missionTabsPercent');
        if (missionTabsPercent !== 0) {
            totalTabs += Math.round(safeBase * missionTabsPercent);
        }
        totalTabs += getActiveEffectNumericSum(gameState, playerData, 'tabsGainBonus');

        totalTabs = Math.max(0, totalTabs);

        playerData.tabs = (playerData.tabs || 0) + totalTabs;
        return totalTabs;
    }

    function applyTabsGain(playerData, baseTabs) {
        const gameState = getGameState();
        const safeBase = Math.max(0, Number(baseTabs || 0));
        if (safeBase <= 0) return 0;

        const adjusted = Math.max(0, safeBase + getActiveEffectNumericSum(gameState, playerData, 'tabsGainBonus'));
        playerData.tabs = (playerData.tabs || 0) + adjusted;
        return adjusted;
    }

    function applyMissionXpReward(playerData, baseXp) {
        const gameState = getGameState();
        const safeBase = Math.max(0, Number(baseXp || 0));
        if (safeBase <= 0) return 0;

        return Math.max(0, safeBase + getActiveEffectNumericSum(gameState, playerData, 'missionXpBonus'));
    }

    function applyScrapRewards(playerData, rewardScrap) {
        const gameState = getGameState();
        const safeMap = rewardScrap && typeof rewardScrap === 'object' ? rewardScrap : {};
        const applied = {};
        const effectScrapBonus = getActiveEffectNumericSum(gameState, playerData, 'scrapRewardBonus');

        Object.entries(safeMap).forEach(([type, rawAmount]) => {
            let amount = Math.max(0, Number(rawAmount || 0));
            if (amount <= 0) {
                return;
            }

            if (hasPerk(playerData, 'p5') && Math.random() < 0.5) {
                amount *= 2;
            }

            amount = Math.max(0, amount + effectScrapBonus);

            if (playerData.scrap[type] === undefined) {
                playerData.scrap[type] = 0;
            }
            playerData.scrap[type] += amount;
            applied[type] = (applied[type] || 0) + amount;
        });

        return applied;
    }

    function applyRandomScrapGain(playerData, baseAmount) {
        const safeBase = Math.max(0, Number(baseAmount || 0));
        if (safeBase <= 0) return null;

        const scrapKeys = Object.keys(playerData.scrap || {});
        if (scrapKeys.length === 0) return null;

        const pick = scrapKeys[Math.floor(Math.random() * scrapKeys.length)];
        let amount = safeBase;

        if (hasPerk(playerData, 'p5') && Math.random() < 0.5) {
            amount *= 2;
        }

        const gameState = getGameState();
        amount = Math.max(0, amount + getActiveEffectNumericSum(gameState, playerData, 'scrapRewardBonus'));
        if (amount <= 0) {
            return null;
        }

        playerData.scrap[pick] = (playerData.scrap[pick] || 0) + amount;
        return { type: pick, amount };
    }

    function applyHealingWithPerks(playerData, baseHeal) {
        const gameState = getGameState();
        const safeBase = Math.max(0, Number(baseHeal || 0));
        if (safeBase <= 0) return 0;

        const multiplier = hasPerk(playerData, 'p4') ? 2 : 1;
        const effectHealingBonus = getActiveEffectNumericSum(gameState, playerData, 'healingBonusFlat');
        const effectHealingPenalty = getActiveEffectNumericSum(gameState, playerData, 'healingPenaltyFlat');
        const healAmount = Math.max(0, Math.ceil(safeBase * multiplier) + effectHealingBonus - effectHealingPenalty);
        const beforeHp = Number(playerData.hp || 0);
        playerData.hp = clamp(beforeHp + healAmount, 0, playerData.maxHp || 10);
        return playerData.hp - beforeHp;
    }

    function applyRadGainWithPerks(playerData, baseRads, { isFood = false } = {}) {
        const gameState = getGameState();
        const safeBase = Math.max(0, Number(baseRads || 0));
        if (safeBase <= 0) return 0;

        if (isFood && hasPerk(playerData, 'p6')) {
            return 0;
        }

        let adjusted = safeBase;
        if (hasPerk(playerData, 'p2')) {
            adjusted = Math.max(0, adjusted - 1);
        }
        if (hasPerk(playerData, 'p12')) {
            adjusted = Math.max(0, adjusted - 1);
        }

        adjusted += getActiveEffectNumericSum(gameState, playerData, 'radGainBonus');
        adjusted -= getActiveEffectNumericSum(gameState, playerData, 'radGainReduction');
        adjusted = Math.max(0, adjusted);

        const beforeRads = Number(playerData.rads || 0);
        playerData.rads = clamp(beforeRads + adjusted, 0, playerData.maxRads || 10);
        return playerData.rads - beforeRads;
    }

    function applyHpLossWithPerks(playerData, baseHpLoss) {
        const gameState = getGameState();
        const safeBase = Math.max(0, Number(baseHpLoss || 0));
        if (safeBase <= 0) return 0;

        let adjusted = safeBase;
        if (hasPerk(playerData, 'p15')) {
            adjusted = Math.max(0, adjusted - 1);
        }

        adjusted += getActiveEffectNumericSum(gameState, playerData, 'hpLossBonus');
        adjusted -= getActiveEffectNumericSum(gameState, playerData, 'hpLossReduction');
        adjusted = Math.max(0, adjusted);

        const beforeHp = Number(playerData.hp || 0);
        playerData.hp = clamp(beforeHp - adjusted, 0, playerData.maxHp || 10);
        return beforeHp - playerData.hp;
    }

    function grantAchievement(gameState, player, achievementId) {
        ensureMetaState(gameState);
        const playerData = gameState.players[player];
        const progress = gameState.playerProgress[player];
        const achievement = (gameState.achievements || []).find(a => a.id === achievementId);
        if (!playerData || !progress || !achievement) return null;
        if (progress.achievements.includes(achievementId)) return null;

        progress.achievements.push(achievementId);
        playerData.achievements = [...progress.achievements];

        const reward = achievement.reward || {};
        applyTabsGain(playerData, Number(reward.tabs || 0));
        addXpWithLeveling(playerData, applyMissionXpReward(playerData, Number(reward.xp || 0)));

        return achievement;
    }

    function evaluateAchievements(gameState, player, context = {}) {
        const playerData = gameState.players[player];
        if (!playerData) return [];

        const unlocked = [];
        if (context.craftedFirstItem && (playerData.craftedGear || []).length >= 1) {
            const added = grantAchievement(gameState, player, 'ach_first_craft');
            if (added) unlocked.push(added);
        }

        if ((playerData.completedQuests || []).length >= 10) {
            const added = grantAchievement(gameState, player, 'ach_quest_runner');
            if (added) unlocked.push(added);
        }

        const maxStat = Math.max(...Object.values(playerData.stats || {}).map(v => Number(v || 0)), 0);
        if (maxStat >= 8) {
            const added = grantAchievement(gameState, player, 'ach_chappy_master');
            if (added) unlocked.push(added);
        }

        if ((gameState.playerProgress?.[player]?.teamObjectiveContributions || 0) >= 3) {
            const added = grantAchievement(gameState, player, 'ach_team_player');
            if (added) unlocked.push(added);
        }

        return unlocked;
    }

    function applyQuestChainProgress(gameState, player, questId) {
        ensureMetaState(gameState);
        const chains = Array.isArray(gameState.questChains) ? gameState.questChains : [];
        const progress = gameState.playerProgress[player];
        const playerData = gameState.players[player];
        if (!progress || !playerData) return null;

        for (const chain of chains) {
            if (!Array.isArray(chain.questIds) || !chain.questIds.includes(questId)) {
                continue;
            }

            const chainState = progress.chainProgress[chain.id] || {
                completedQuestIds: [],
                completed: false
            };

            if (!chainState.completedQuestIds.includes(questId)) {
                chainState.completedQuestIds.push(questId);
            }

            const allComplete = chain.questIds.every(id => chainState.completedQuestIds.includes(id));
            let finalRewardApplied = false;

            if (allComplete && !chainState.completed) {
                chainState.completed = true;
                const reward = chain.finalReward || {};
                applyMissionTabsReward(playerData, Number(reward.tabs || 0));
                addXpWithLeveling(playerData, applyMissionXpReward(playerData, Number(reward.xp || 0)));

                if (reward.perkId && Array.isArray(playerData.unlockedPerks) && !playerData.unlockedPerks.includes(reward.perkId)) {
                    playerData.unlockedPerks.push(reward.perkId);
                }

                if (reward.item) {
                    if (!Array.isArray(playerData.inventory)) {
                        playerData.inventory = [];
                    }
                    playerData.inventory.push({ id: `reward-${Date.now()}`, name: reward.item, qty: 1 });
                }

                finalRewardApplied = true;
            }

            progress.chainProgress[chain.id] = chainState;
            return {
                chainId: chain.id,
                chainName: chain.name,
                completedQuestIds: [...chainState.completedQuestIds],
                complete: Boolean(chainState.completed),
                finalRewardApplied
            };
        }

        return null;
    }

    function applyClassPassive(gameState, player, trigger) {
        const playerData = gameState.players[player];
        if (!playerData) return null;
        const passiveKey = syncPlayerPassive(gameState, player);

        if (passiveKey === 'scavenger' && trigger === 'encounter') {
            const scrapKeys = Object.keys(playerData.scrap || {});
            if (scrapKeys.length > 0) {
                const pick = scrapKeys[Math.floor(Math.random() * scrapKeys.length)];
                const amount = Math.max(0, 1 + getActiveEffectNumericSum(gameState, playerData, 'scrapRewardBonus'));
                if (amount > 0) {
                    playerData.scrap[pick] = (playerData.scrap[pick] || 0) + amount;
                    gameState.sessionMetrics.scrapGained[player] = (gameState.sessionMetrics.scrapGained[player] || 0) + amount;
                    return { passiveKey, text: `Scavenger proc: +${amount} ${pick}` };
                }
            }
        }

        if (passiveKey === 'vanguard' && trigger === 'encounter') {
            const healed = applyHealingWithPerks(playerData, 1);
            if (healed > 0) {
                return { passiveKey, text: `Vanguard proc: +${healed} HP` };
            }
        }

        if (passiveKey === 'diplomat' && trigger === 'quest') {
            applyTabsGain(playerData, 2);
            return { passiveKey, text: 'Diplomat proc: +2 Tabs' };
        }

        return null;
    }

    function resolveTeamObjectiveDiceOutcome(gameState, objective) {
        const roll = Math.floor(Math.random() * 20) + 1;
        const baseTabs = Number(objective?.reward?.tabs || 0);
        const baseXp = Number(objective?.reward?.xp || 0);

        let label = 'SOLID SUCCESS';
        let message = 'Team execution was steady. Full rewards granted.';
        let tabsMultiplier = 1;
        let xpMultiplier = 1;
        let hpLoss = 0;
        let radsGain = 0;
        let randomScrap = 0;

        if (roll <= 4) {
            label = 'CATASTROPHIC SETBACK';
            message = 'The operation collapsed. No tabs/xp reward; everyone took minor damage and rads.';
            tabsMultiplier = 0;
            xpMultiplier = 0;
            hpLoss = 1;
            radsGain = 1;
        } else if (roll <= 9) {
            label = 'ROUGH COMPLETION';
            message = 'The team finished, but with losses. Reduced rewards granted.';
            tabsMultiplier = 0.5;
            xpMultiplier = 0.5;
        } else if (roll >= 19) {
            label = 'CRITICAL SUCCESS';
            message = 'Perfect coordination. Bonus rewards and salvage recovered.';
            tabsMultiplier = 1.5;
            xpMultiplier = 1.5;
            randomScrap = 1;
        }

        const perPlayer = {};
        Object.keys(gameState.players || {}).forEach((playerKey) => {
            const playerData = gameState.players[playerKey];

            const tabsBase = Math.max(0, Math.round(baseTabs * tabsMultiplier));
            const xpBase = Math.max(0, Math.round(baseXp * xpMultiplier));
            const tabsAwarded = applyMissionTabsReward(playerData, tabsBase);
            const xpAwarded = applyMissionXpReward(playerData, xpBase);
            const levelsGained = addXpWithLeveling(playerData, xpAwarded);

            const hpLost = hpLoss > 0 ? applyHpLossWithPerks(playerData, hpLoss) : 0;
            const radsAdded = radsGain > 0 ? applyRadGainWithPerks(playerData, radsGain) : 0;

            let scrap = null;
            if (randomScrap > 0) {
                scrap = applyRandomScrapGain(playerData, randomScrap);
                if (scrap) {
                    gameState.sessionMetrics.scrapGained[playerKey] = (gameState.sessionMetrics.scrapGained[playerKey] || 0) + Number(scrap.amount || 0);
                }
            }

            gameState.playerProgress[playerKey].teamContribution = false;
            perPlayer[playerKey] = {
                tabs: tabsAwarded,
                xp: xpAwarded,
                levelsGained,
                hpLost,
                radsAdded,
                scrap
            };
        });

        return {
            roll,
            label,
            message,
            baseReward: { tabs: baseTabs, xp: baseXp },
            perPlayer
        };
    }

    function buildSessionRecap(gameState) {
        ensureMetaState(gameState);
        const metrics = gameState.sessionMetrics;
        const questStats = metrics.questCompletions || {};
        const scrapStats = metrics.scrapGained || {};

        const topScavenger = Object.entries(scrapStats).sort((a, b) => b[1] - a[1])[0] || ['logan', 0];
        const funniestRadio = metrics.funniestRadio || { text: 'No player transmissions this session.' };

        const teasers = [
            'A distant beacon pings from beyond the fog line.',
            'An unknown faction marks your vault on an old map.',
            'A buried relay bunker powers on during the night.'
        ];

        const recap = {
            generatedAt: new Date().toISOString(),
            questsDone: questStats,
            funniestRadio,
            topScavenger: { player: topScavenger[0], scrapGained: topScavenger[1] || 0 },
            teaser: teasers[Math.floor(Math.random() * teasers.length)]
        };

        metrics.lastRecap = recap;
        return recap;
    }

    app.get('/api/game-state', (req, res) => {
        const gameState = getGameState();
        const migratedState = migrateGameState(gameState);
        if (migratedState && migratedState !== gameState) {
            setGameState(migratedState);
        }

        const currentState = getGameState();
        ensureMetaState(currentState);
        Object.values(currentState.players).forEach(ensurePlayerProgressFields);
        Object.keys(currentState.players || {}).forEach((playerKey) => {
            syncPlayerPassive(currentState, playerKey);
            const progress = currentState.playerProgress?.[playerKey];
            if (progress) {
                currentState.players[playerKey].achievements = [...(progress.achievements || [])];
            }
        });
        res.json(currentState);
    });

    app.get('/api/save/export', (req, res) => {
        const gameState = getGameState();
        Object.values(gameState.players).forEach(ensurePlayerProgressFields);
        res.json({
            exportedAt: new Date().toISOString(),
            version: getGameStateVersion(),
            state: gameState
        });
    });

    app.post('/api/save/import', async (req, res) => {
        const incomingState = req.body?.state || req.body;

        if (!incomingState || typeof incomingState !== 'object') {
            return res.status(400).json({ error: 'Invalid payload. Provide a game state object or { state: ... }.' });
        }

        const migratedState = migrateGameState(incomingState);
        if (!migratedState || !migratedState.players || typeof migratedState.players !== 'object') {
            return res.status(400).json({ error: 'Invalid game state structure.' });
        }

        const playerKeys = Object.keys(migratedState.players);
        if (playerKeys.length === 0) {
            return res.status(400).json({ error: 'Imported game state must include at least one player.' });
        }

        const previousState = getGameState();

        try {
            setGameState(migratedState);
            const gameState = getGameState();
            Object.values(gameState.players).forEach(ensurePlayerProgressFields);
            await persistGameState('import', true);

            return res.json({
                success: true,
                message: 'Game state imported successfully.',
                players: playerKeys
            });
        } catch (error) {
            setGameState(previousState);
            return res.status(500).json({ error: `Import failed: ${error.message}` });
        }
    });

    app.post('/api/player/:player/stat/:stat', (req, res) => {
        const { player, stat } = req.params;
        const { value } = req.body;
        const gameState = getGameState();

        const validation = validateNumber(value, { min: -999999, max: 999999, integer: true, label: 'value' });
        if (!validation.ok) {
            return res.status(400).json({ error: validation.error });
        }

        if (gameState.players[player] && gameState.players[player][stat] !== undefined) {
            const playerData = gameState.players[player];
            if (stat === 'xp') {
                playerData.level = Math.max(1, Number(playerData.level) || 1);
                playerData.xp = Math.max(0, (Number(playerData.xp) || 0) + Number(validation.value || 0));

                let levelsGained = 0;
                let xpNeeded = getXpRequiredForLevel(playerData.level);
                while (playerData.xp >= xpNeeded) {
                    playerData.xp -= xpNeeded;
                    playerData.level = Number(playerData.level) + 1;
                    levelsGained += 1;
                    xpNeeded = getXpRequiredForLevel(playerData.level);
                }

                if (levelsGained > 0) {
                    playerData.pendingPerks = (playerData.pendingPerks || 0) + levelsGained;
                }
            } else {
                playerData[stat] = validation.value;
            }

            ensurePlayerProgressFields(playerData);
            syncPlayerPassive(gameState, player);
            const unlocked = evaluateAchievements(gameState, player);
            scheduleAutoSave();
            res.json({ success: true, message: `Updated ${player} ${stat}`, achievementsUnlocked: unlocked.map(a => a.id) });
        } else {
            res.status(404).json({ error: 'Player or stat not found' });
        }
    });

    app.post('/api/player/:player/stats', (req, res) => {
        const { player } = req.params;
        const { stats } = req.body;
        const gameState = getGameState();

        const statKeys = ['charm', 'hardiness', 'agility', 'perception', 'politeness', 'yarns'];
        const statsValidation = validateNumericRecord(stats, {
            allowedKeys: statKeys,
            min: 0,
            max: 20,
            integer: true,
            label: 'stats'
        });

        if (!statsValidation.ok) {
            return res.status(400).json({ error: statsValidation.error });
        }

        if (gameState.players[player]) {
            gameState.players[player].stats = stats;
            syncPlayerPassive(gameState, player);
            const unlocked = evaluateAchievements(gameState, player);
            scheduleAutoSave();
            res.json({ success: true, message: `Updated ${player} stats`, stats: stats, achievementsUnlocked: unlocked.map(a => a.id) });
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/faction', (req, res) => {
        const { player } = req.params;
        const { faction } = req.body || {};
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }

        if (typeof faction !== 'string' || !FACTION_OPTIONS.includes(faction)) {
            return res.status(400).json({
                error: 'Invalid faction selection.',
                options: FACTION_OPTIONS
            });
        }

        playerData.faction = faction;
        scheduleAutoSave();
        return res.json({ success: true, faction, options: FACTION_OPTIONS });
    });

    app.post('/api/player/:player/quest', (req, res) => {
        const { player } = req.params;
        const { questId } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        if (!questId) {
            return res.status(400).json({ error: 'questId is required' });
        }

        if (gameState.players[player] && questId) {
            const quest = gameState.quests.find(q => q.id === questId);
            if (quest && !gameState.players[player].activeQuests.includes(questId)) {
                gameState.players[player].activeQuests.push(questId);
                ensureMetaState(gameState);
                syncPlayerPassive(gameState, player);

                const radioId = gameState.questRadioMap[questId];
                if (radioId) {
                    gameState.players[player].activeRadio = radioId;
                    gameState.players[player].activeRadioData = null;
                }

                const chainInfo = (gameState.questChains || []).find(chain => (chain.questIds || []).includes(questId)) || null;

                scheduleAutoSave();
                res.json({
                    success: true,
                    message: `Quest sent to ${player}`,
                    chain: chainInfo ? { id: chainInfo.id, name: chainInfo.name } : null
                });
            } else {
                res.status(400).json({ error: 'Quest already active or not found' });
            }
        }
    });

    app.post('/api/player/:player/radio', (req, res) => {
        const { player } = req.params;
        const { radioId } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        if (!radioId) {
            return res.status(400).json({ error: 'radioId is required' });
        }

        if (gameState.players[player]) {
            ensureMetaState(gameState);
            const trapSignalIds = gameState.radioConsequences?.trapSignalIds || [];
            const isTrap = trapSignalIds.includes(radioId);

            gameState.players[player].activeRadio = radioId;
            gameState.players[player].activeRadioData = isTrap
                ? {
                    id: `trap_${Date.now()}`,
                    title: 'SUSPICIOUS TRANSMISSION',
                    text: 'This broadcast may be a decoy. Verify signal integrity before acting.',
                    isTrapCandidate: true,
                    verifyDc: gameState.radioConsequences?.verifyDc || 10,
                    verified: false
                }
                : null;
            scheduleAutoSave();
            res.json({ success: true, message: `Radio signal sent to ${player}`, isTrapCandidate: isTrap });
        }
    });

    app.post('/api/player/:player/radio-message', (req, res) => {
        const { player } = req.params;
        const { message } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be text' });
        }

        const cleanedMessage = message.trim();
        if (cleanedMessage.length === 0 || cleanedMessage.length > 280) {
            return res.status(400).json({ error: 'Message must be 1-280 characters' });
        }

        const customSignal = {
            id: `custom_${Date.now()}`,
            title: 'OVERSEER TRANSMISSION',
            frequency: '88.5 FM',
            text: cleanedMessage,
            type: 'custom'
        };

        gameState.players[player].activeRadio = customSignal.id;
        gameState.players[player].activeRadioData = customSignal;
        scheduleAutoSave();
        res.json({ success: true, message: 'Custom signal sent', signal: customSignal });
    });

    app.post('/api/player/:player/radio/verify', (req, res) => {
        const { player } = req.params;
        const { stat = 'perception' } = req.body || {};
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const activeData = playerData.activeRadioData;
        if (!activeData || !activeData.isTrapCandidate || activeData.verified) {
            return res.status(400).json({ error: 'No unverified trap signal is active.' });
        }

        const statKey = CHAPPY_STATS.includes(String(stat)) ? stat : 'perception';
        const statValue = Number(playerData.stats?.[statKey] || 0) + getActiveEffectStatCheckBonus(gameState, playerData, statKey);
        const roll = Math.floor(Math.random() * 20) + 1;
        const total = roll + statValue;
        const dcBase = Number(gameState.radioConsequences?.verifyDc || 10);
        const dc = Math.max(1, dcBase + getActiveEffectNumericSum(gameState, playerData, 'radioVerifyDcBonus'));

        let outcome = 'success';
        let notes = [];
        if (total >= dc) {
            const tabsGainBase = Number(gameState.radioConsequences?.success?.tabsGain || 0);
            const tabsGain = applyTabsGain(playerData, tabsGainBase);
            const passive = syncPlayerPassive(gameState, player);
            if (passive === 'signaler') {
                applyTabsGain(playerData, 2);
                notes.push('Class passive: +2 Tabs');
            }

            activeData.verified = true;
            activeData.text = `${activeData.text}\n\nVERIFIED: Signal authenticated. Decoy avoided.`;
            if (tabsGain > 0) {
                notes.push(`+${tabsGain} Tabs`);
            }
        } else {
            outcome = 'failure';
            const hpLoss = Number(gameState.radioConsequences?.failure?.hpLoss || 1);
            const radsGain = Number(gameState.radioConsequences?.failure?.radsGain || 1);
            const hpLost = applyHpLossWithPerks(playerData, hpLoss);
            const radsAdded = applyRadGainWithPerks(playerData, radsGain);
            activeData.verified = true;
            activeData.text = `${activeData.text}\n\nFAILURE: It was a trap. You took damage and radiation.`;
            notes.push(`HP -${hpLost}`);
            notes.push(`RADS +${radsAdded}`);
        }

        scheduleAutoSave();
        res.json({
            success: true,
            outcome,
            check: { stat: statKey, roll, statValue, total, dc },
            notes,
            activeRadioData: activeData,
            hp: playerData.hp,
            rads: playerData.rads,
            tabs: playerData.tabs
        });
    });

    app.post('/api/player/:player/radio-overseer', (req, res) => {
        const { player } = req.params;
        const { message } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be text' });
        }

        const cleanedMessage = message.trim();
        if (cleanedMessage.length === 0 || cleanedMessage.length > 280) {
            return res.status(400).json({ error: 'Message must be 1-280 characters' });
        }

        ensureMetaState(gameState);

        if (!Array.isArray(gameState.overseerInbox)) {
            gameState.overseerInbox = [];
        }

        const transmission = {
            id: `ovr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            player,
            title: `${player.toUpperCase()} TRANSMISSION`,
            text: cleanedMessage,
            createdAt: new Date().toISOString()
        };

        gameState.overseerInbox.unshift(transmission);
        if (gameState.overseerInbox.length > 100) {
            gameState.overseerInbox = gameState.overseerInbox.slice(0, 100);
        }

        const currentFunniest = gameState.sessionMetrics.funniestRadio;
        const funnyScore = (text) => {
            const source = String(text || '').toLowerCase();
            const markers = ['haha', 'lol', 'lmao', 'boom', 'donair', 'moose', 'fiddle'];
            return markers.reduce((sum, marker) => sum + (source.includes(marker) ? 2 : 0), 0) + Math.min(5, Math.floor(source.length / 60));
        };
        const incomingScore = funnyScore(cleanedMessage);
        const currentScore = currentFunniest ? funnyScore(currentFunniest.text) : -1;
        if (!currentFunniest || incomingScore >= currentScore) {
            gameState.sessionMetrics.funniestRadio = {
                player,
                text: cleanedMessage,
                score: incomingScore,
                at: transmission.createdAt
            };
        }

        scheduleAutoSave();
        res.json({ success: true, message: 'Transmission sent to Overseer', transmission });
    });

    app.post('/api/player/:player/scrap/:type', (req, res) => {
        const { player, type } = req.params;
        const { amount } = req.body;
        const gameState = getGameState();

        const amountValidation = validateNumber(amount, { min: -999, max: 999, integer: true, label: 'amount' });
        if (!amountValidation.ok) {
            return res.status(400).json({ error: amountValidation.error });
        }

        if (gameState.players[player] && gameState.players[player].scrap[type] !== undefined) {
            gameState.players[player].scrap[type] += amountValidation.value;
            scheduleAutoSave();
            res.json({ success: true, amount: gameState.players[player].scrap[type] });
        } else {
            res.status(404).json({ error: 'Player or scrap type not found' });
        }
    });

    app.post('/api/player/:player/scrap/multi', (req, res) => {
        const { player } = req.params;
        const { scrapMap } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const allowedScrapKeys = Object.keys(gameState.players[player].scrap || {});
        const scrapValidation = validateNumericRecord(scrapMap, {
            allowedKeys: allowedScrapKeys,
            min: 1,
            max: 999,
            integer: true,
            label: 'scrapMap'
        });

        if (!scrapValidation.ok) {
            return res.status(400).json({ error: scrapValidation.error });
        }

        const playerScrap = gameState.players[player].scrap;
        let totalGranted = 0;

        Object.entries(scrapMap).forEach(([type, amount]) => {
            playerScrap[type] += amount;
            totalGranted += amount;
        });

        scheduleAutoSave();
        res.json({ success: true, totalGranted, scrap: playerScrap });
    });

    app.post('/api/player/:player/complete-quest', (req, res) => {
        const { player } = req.params;
        const { questId } = req.body;
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (playerData) {
            ensureMetaState(gameState);
            ensurePlayerProgressFields(playerData);
            const quest = gameState.quests.find(q => q.id === questId);
            if (quest) {
                if (!playerData.activeQuests.includes(questId)) {
                    return res.status(400).json({ error: 'Quest is not currently active for this player' });
                }
                if (playerData.completedQuests.includes(questId)) {
                    return res.status(400).json({ error: 'Quest already completed' });
                }

                playerData.activeQuests = playerData.activeQuests.filter(q => q !== questId);
                playerData.completedQuests.push(questId);
                const tabsReward = quest.rewardTabs || 0;
                const xpReward = quest.xp || 0;
                const tabsAwarded = applyMissionTabsReward(playerData, tabsReward);
                const xpAwarded = applyMissionXpReward(playerData, xpReward);
                addXpWithLeveling(playerData, xpAwarded);

                if (quest.rewardScrap) {
                    const appliedScrap = applyScrapRewards(playerData, quest.rewardScrap);
                    Object.values(appliedScrap).forEach((amount) => {
                        gameState.sessionMetrics.scrapGained[player] = (gameState.sessionMetrics.scrapGained[player] || 0) + Number(amount || 0);
                    });
                }

                const chainUpdate = applyQuestChainProgress(gameState, player, questId);
                const passiveProc = applyClassPassive(gameState, player, 'quest');
                const unlockedAchievements = evaluateAchievements(gameState, player);
                gameState.sessionMetrics.questCompletions[player] = (gameState.sessionMetrics.questCompletions[player] || 0) + 1;

                scheduleAutoSave();
                res.json({
                    success: true,
                    message: `${player} completed ${quest.title}`,
                    reward: {
                        tabs: tabsAwarded,
                        xp: xpAwarded
                    },
                    chainUpdate,
                    passiveProc,
                    achievementsUnlocked: unlockedAchievements.map(a => ({ id: a.id, name: a.name }))
                });
            } else {
                return res.status(404).json({ error: 'Quest not found' });
            }
        } else {
            return res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/perk/:perkId', (req, res) => {
        const { player, perkId } = req.params;
        const gameState = getGameState();

        if (gameState.players[player] && gameState.perks.find(p => p.id === perkId)) {
            if ((gameState.players[player].pendingPerks || 0) <= 0) {
                return res.status(400).json({ error: 'No perk selections available' });
            }
            if (!gameState.players[player].unlockedPerks.includes(perkId)) {
                gameState.players[player].unlockedPerks.push(perkId);
                gameState.players[player].pendingPerks -= 1;
                ensurePlayerProgressFields(gameState.players[player]);
                scheduleAutoSave();
                res.json({ success: true, message: `Perk added to ${player}` });
            } else {
                res.status(400).json({ error: 'Perk already unlocked' });
            }
        } else {
            res.status(404).json({ error: 'Player or perk not found' });
        }
    });

    app.delete('/api/player/:player/perk/:perkId', (req, res) => {
        const { player, perkId } = req.params;
        const gameState = getGameState();

        if (gameState.players[player]) {
            gameState.players[player].unlockedPerks = gameState.players[player].unlockedPerks.filter(p => p !== perkId);
            ensurePlayerProgressFields(gameState.players[player]);
            scheduleAutoSave();
            res.json({ success: true, message: `Perk removed from ${player}` });
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/effect/:effectId', (req, res) => {
        const { player, effectId } = req.params;
        const gameState = getGameState();
        const playerData = gameState.players[player];
        const effect = gameState.statusEffects.find(e => e.id === effectId);

        if (!playerData) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (!effect) {
            return res.status(404).json({ error: 'Effect not found' });
        }

        if (!playerData.activeEffects.includes(effectId)) {
            playerData.activeEffects.push(effectId);

            if (effect.effects) {
                Object.entries(effect.effects).forEach(([stat, value]) => {
                    if (stat === 'hp' && typeof value === 'number') {
                        playerData.hp = clamp((playerData.hp || 0) + value, 0, playerData.maxHp || 10);
                    } else if (stat === 'rads' && typeof value === 'number') {
                        playerData.rads = clamp((playerData.rads || 0) + value, 0, playerData.maxRads || 10);
                    } else if (stat === 'tabs' && typeof value === 'number') {
                        playerData.tabs = Math.max(0, (playerData.tabs || 0) + value);
                    } else if (playerData.stats && playerData.stats[stat] !== undefined) {
                        playerData.stats[stat] += value;
                    }
                });
            }

            ensurePlayerProgressFields(playerData);

            scheduleAutoSave();
            res.json({ success: true, message: `Effect "${effect.name}" applied to ${player}`, effect });
        } else {
            res.status(400).json({ error: 'Player already has this effect' });
        }
    });

    app.delete('/api/player/:player/effect/:effectId', (req, res) => {
        const { player, effectId } = req.params;
        const gameState = getGameState();
        const effect = gameState.statusEffects.find(e => e.id === effectId);

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        gameState.players[player].activeEffects = gameState.players[player].activeEffects.filter(e => e !== effectId);

        if (effect && effect.effects) {
            Object.entries(effect.effects).forEach(([stat, value]) => {
                if (stat === 'hp' && typeof value === 'number') {
                    gameState.players[player].hp = clamp((gameState.players[player].hp || 0) - value, 0, gameState.players[player].maxHp || 10);
                } else if (stat === 'rads' && typeof value === 'number') {
                    gameState.players[player].rads = clamp((gameState.players[player].rads || 0) - value, 0, gameState.players[player].maxRads || 10);
                } else if (stat === 'tabs' && typeof value === 'number') {
                    gameState.players[player].tabs = Math.max(0, (gameState.players[player].tabs || 0) - value);
                } else if (gameState.players[player].stats && gameState.players[player].stats[stat] !== undefined) {
                    gameState.players[player].stats[stat] -= value;
                }
            });
        }

        ensurePlayerProgressFields(gameState.players[player]);

        scheduleAutoSave();
        res.json({ success: true, message: `Effect removed from ${player}` });
    });

    app.post('/api/player/:player/craft/:recipeId', (req, res) => {
        const { player, recipeId } = req.params;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }
        const playerData = gameState.players[player];
        if (!Array.isArray(playerData.craftedGear)) {
            playerData.craftedGear = [];
        }
        ensureMetaState(gameState);
        syncPlayerPassive(gameState, player);

        const finalizeCraft = (payload) => {
            const unlocked = evaluateAchievements(gameState, player, { craftedFirstItem: true });
            scheduleAutoSave();
            return res.json({
                ...payload,
                achievementsUnlocked: unlocked.map(a => ({ id: a.id, name: a.name }))
            });
        };

        const recipe = gameState.recipes.find(r => r.id === recipeId);
        if (!recipe) {
            return res.status(404).json({ error: 'Recipe not found' });
        }

        const oneTimeGearEffects = {
            r1: { stats: { agility: 1 }, text: 'Agility +1 (Bluenose Bayonet equipped).' },
            r2: { stats: { hardiness: 1 }, maxHp: 2, hp: 2, text: 'Hardiness +1 and Max HP +2 (Trapper\'s Plate equipped).' },
            r7: { stats: { agility: 1, hardiness: 1 }, text: 'Agility +1 and Hardiness +1 (Peggy\'s Cove Cleats equipped).' },
            r8: { stats: { perception: 1 }, text: 'Perception +1 (Basin Fog Lens equipped).' },
            r9: { stats: { charm: 1, politeness: 1 }, text: 'Charm +1 and Politeness +1 (Apple-Core Sash equipped).' },
            r10: { stats: { perception: 1 }, text: 'Perception +1 (Scout Notebook equipped).' },
            r11: { stats: { politeness: 1 }, text: 'Politeness +1 (Signal Flag Kit equipped).' }
        };

        if (oneTimeGearEffects[recipe.id] && playerData.craftedGear.includes(recipe.id)) {
            return res.status(400).json({ error: `${recipe.name} is already crafted and equipped.` });
        }

        const playerScrap = playerData.scrap;
        for (const ingredient of recipe.ingredients) {
            if (ingredient.type === 'propaneTank' || ingredient.type === 'syntheticSap' ||
                ingredient.type === 'maritimeMetal' || ingredient.type === 'plaidScraps' ||
                ingredient.type === 'radMeat' || ingredient.type === 'spices' ||
                ingredient.type === 'cleanWater' || ingredient.type === 'hubCircuitry') {
                if (!playerScrap[ingredient.type] || playerScrap[ingredient.type] < ingredient.amount) {
                    return res.status(400).json({ error: `Not enough ${ingredient.type}` });
                }
            }
        }

        for (const ingredient of recipe.ingredients) {
            if (ingredient.type !== 'inventory') {
                playerScrap[ingredient.type] -= ingredient.amount;
            }
        }

        if (oneTimeGearEffects[recipe.id]) {
            const effect = oneTimeGearEffects[recipe.id];

            if (effect.stats) {
                Object.entries(effect.stats).forEach(([stat, value]) => {
                    if (playerData.stats && playerData.stats[stat] !== undefined) {
                        playerData.stats[stat] += value;
                    }
                });
            }

            if (effect.maxHp) {
                playerData.maxHp = (playerData.maxHp || 10) + effect.maxHp;
            }

            if (effect.hp) {
                playerData.hp = clamp((playerData.hp || 0) + effect.hp, 0, playerData.maxHp || 10);
            }

            playerData.craftedGear.push(recipe.id);
            return finalizeCraft({
                success: true,
                message: `Crafted ${recipe.name}! ${effect.text}`,
                effect: effect
            });
        }

        if (recipe.id === 'r3') {
            const tabsGained = applyTabsGain(playerData, 15);
            return finalizeCraft({
                success: true,
                message: 'Crafted Propane Popper! Salvage blast recovered +15 Tabs.',
                effect: { tabsGained, tabs: playerData.tabs }
            });
        }

        if (recipe.id === 'r4') {
            const healAmount = Math.max(1, Math.ceil((playerData.maxHp || 10) * 0.5));
            const beforeHp = playerData.hp || 0;
            const beforeRads = playerData.rads || 0;

            const restored = applyHealingWithPerks(playerData, healAmount);
            const radsAdded = applyRadGainWithPerks(playerData, 10, { isFood: true });

            return finalizeCraft({
                success: true,
                message: radsAdded === 0
                    ? 'Crafted Donair-Dab Kit! Restored HP with no RAD gain (Lead Belly).'
                    : 'Crafted Donair-Dab Kit! Restored HP and gained RADS.',
                effect: {
                    hpRestored: restored,
                    radsAdded,
                    hp: playerData.hp,
                    rads: playerData.rads
                }
            });
        }

        if (recipe.id === 'r5') {
            const healAmount = 4;
            const healed = applyHealingWithPerks(playerData, healAmount);
            return finalizeCraft({
                success: true,
                message: `Crafted STIMPAK! Restored ${healed} HP.`,
                effect: { hpRestored: healed, hp: playerData.hp, maxHp: playerData.maxHp || 10 }
            });
        }

        if (recipe.id === 'r6') {
            const removeRads = 2;
            const beforeRads = playerData.rads || 0;
            playerData.rads = clamp(beforeRads - removeRads, 0, playerData.maxRads || 10);
            const reduced = beforeRads - playerData.rads;
            return finalizeCraft({
                success: true,
                message: `Crafted RAD-AWAY! Removed ${reduced} RADS.`,
                effect: { radsRemoved: reduced, rads: playerData.rads }
            });
        }

        if (recipe.id === 'r12') {
            const restored = applyHealingWithPerks(playerData, 2);
            const tabsGained = applyTabsGain(playerData, 2);
            return finalizeCraft({
                success: true,
                message: `Crafted Trail Mix Pack! Restored ${restored} HP and gained +2 Tabs.`,
                effect: { hpRestored: restored, tabsGained, hp: playerData.hp, tabs: playerData.tabs }
            });
        }

        return res.status(400).json({ error: 'No craft effect configured for this recipe.' });
    });

    app.get('/api/quarters-shop', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.quarterUpgrades);
    });

    app.get('/api/player/:player/quarters', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();

        if (gameState.players[player]) {
            const playerUpgrades = gameState.players[player].purchasedUpgrades.map(upgradeId =>
                gameState.quarterUpgrades.find(u => u.id === upgradeId)
            ).filter(u => u);
            res.json(playerUpgrades);
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    });

    app.post('/api/player/:player/quarters/:upgradeId', (req, res) => {
        const { player, upgradeId } = req.params;
        const gameState = getGameState();

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const upgrade = gameState.quarterUpgrades.find(u => u.id === upgradeId);
        if (!upgrade) {
            return res.status(404).json({ error: 'Upgrade not found' });
        }

        if (gameState.players[player].purchasedUpgrades.includes(upgradeId)) {
            return res.status(400).json({ error: 'Upgrade already purchased' });
        }

        if (gameState.players[player].tabs < upgrade.cost) {
            return res.status(400).json({ error: `Need ${upgrade.cost} tabs, only have ${gameState.players[player].tabs}` });
        }

        gameState.players[player].tabs -= upgrade.cost;
        gameState.players[player].purchasedUpgrades.push(upgradeId);

        if (upgrade.stat && upgrade.statBoost) {
            gameState.players[player].stats[upgrade.stat] += upgrade.statBoost;
        }
        scheduleAutoSave();

        res.json({
            success: true,
            message: `Purchased ${upgrade.name}!`,
            upgrade: upgrade,
            remainingTabs: gameState.players[player].tabs
        });
    });

    app.get('/api/broadcast-signals', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.broadcastSignals);
    });

    app.post('/api/broadcast/random', (req, res) => {
        const gameState = getGameState();

        if (!gameState.broadcastSignals || gameState.broadcastSignals.length === 0) {
            return res.status(400).json({ error: 'No broadcast signals available' });
        }

        const randomSignal = gameState.broadcastSignals[Math.floor(Math.random() * gameState.broadcastSignals.length)];

        for (const player in gameState.players) {
            gameState.players[player].activeRadio = randomSignal.id;
            gameState.players[player].activeRadioData = null;
        }

        scheduleAutoSave();
        res.json({ success: true, message: 'Broadcast sent to all players', signal: randomSignal });
    });

    app.post('/api/encounter/random', (req, res) => {
        const gameState = getGameState();

        if (!gameState.randomEncounters || gameState.randomEncounters.length === 0) {
            return res.status(400).json({ error: 'No random encounters available' });
        }

        const encounter = gameState.randomEncounters[Math.floor(Math.random() * gameState.randomEncounters.length)];

        for (const player in gameState.players) {
            gameState.players[player].activeRadio = null;
            gameState.players[player].activeRadioData = {
                title: encounter.title,
                text: encounter.text,
                encounterId: encounter.id,
                requiresResolve: true
            };
        }

        scheduleAutoSave();
        res.json({ success: true, message: 'Encounter sent to all players', encounter: encounter });
    });

    app.post('/api/player/:player/encounter/resolve', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        const playerData = gameState.players[player];

        if (!playerData || !playerData.activeRadioData || !playerData.activeRadioData.requiresResolve) {
            return res.status(400).json({ error: 'No encounter to resolve' });
        }

        const outcome = applyEncounterOutcome(player);
        const extraText = outcome.extra ? ` (${outcome.extra})` : '';
        playerData.activeRadioData.text = `${playerData.activeRadioData.text}\n\nRESOLVED: ${outcome.text}${extraText}`;
        playerData.activeRadioData.requiresResolve = false;
        const passiveProc = applyClassPassive(gameState, player, 'encounter');

        scheduleAutoSave();
        res.json({ success: true, outcome: outcome, passiveProc, radio: playerData.activeRadioData });
    });

    app.get('/api/trades/pending', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.trades);
    });

    app.get('/api/player/:player/trades', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        const playerTrades = gameState.trades.filter(t => t.from === player || t.to === player);
        res.json(playerTrades);
    });

    app.post('/api/player/:player/trade/offer', (req, res) => {
        const { player } = req.params;
        const { toPlayer, offeringScrap, requestingScrap } = req.body;
        const gameState = getGameState();

        if (!gameState.players[player] || !gameState.players[toPlayer]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        if (player === toPlayer) {
            return res.status(400).json({ error: 'Cannot trade with yourself' });
        }

        for (const [scrapType, amount] of Object.entries(offeringScrap)) {
            if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
                return res.status(400).json({ error: `Not enough ${scrapType}` });
            }
        }

        const trade = {
            id: `trade-${Date.now()}`,
            from: player,
            to: toPlayer,
            offeringScrap: offeringScrap,
            requestingScrap: requestingScrap,
            status: 'pending',
            createdAt: Date.now()
        };

        gameState.trades.push(trade);
        scheduleAutoSave();

        res.json({ success: true, message: `Trade offer sent to ${toPlayer}!`, trade: trade });
    });

    app.post('/api/trade/:tradeId/accept', (req, res) => {
        const { tradeId } = req.params;
        const { player } = req.body;
        const gameState = getGameState();

        const trade = gameState.trades.find(t => t.id === tradeId);
        if (!trade) {
            return res.status(404).json({ error: 'Trade not found' });
        }

        if (trade.to !== player) {
            return res.status(400).json({ error: 'You cannot accept this trade' });
        }

        if (trade.status !== 'pending') {
            return res.status(400).json({ error: 'Trade is no longer pending' });
        }

        for (const [scrapType, amount] of Object.entries(trade.requestingScrap)) {
            if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
                return res.status(400).json({ error: `Not enough ${scrapType} to complete trade` });
            }
        }

        for (const [scrapType, amount] of Object.entries(trade.offeringScrap)) {
            if (!gameState.players[trade.from].scrap[scrapType] || gameState.players[trade.from].scrap[scrapType] < amount) {
                return res.status(400).json({ error: 'Offering player no longer has required scrap' });
            }
        }

        for (const [scrapType, amount] of Object.entries(trade.offeringScrap)) {
            gameState.players[trade.from].scrap[scrapType] -= amount;
            gameState.players[player].scrap[scrapType] += amount;
        }

        for (const [scrapType, amount] of Object.entries(trade.requestingScrap)) {
            gameState.players[player].scrap[scrapType] -= amount;
            gameState.players[trade.from].scrap[scrapType] += amount;
        }

        trade.status = 'accepted';
        trade.acceptedAt = Date.now();
        scheduleAutoSave();

        res.json({ success: true, message: 'Trade accepted!', trade: trade });
    });

    app.post('/api/trade/:tradeId/reject', (req, res) => {
        const { tradeId } = req.params;
        const { player } = req.body;
        const gameState = getGameState();

        const trade = gameState.trades.find(t => t.id === tradeId);
        if (!trade) {
            return res.status(404).json({ error: 'Trade not found' });
        }

        if (trade.to !== player) {
            return res.status(400).json({ error: 'You cannot reject this trade' });
        }

        if (trade.status !== 'pending') {
            return res.status(400).json({ error: 'Trade is no longer pending' });
        }

        trade.status = 'rejected';
        trade.rejectedAt = Date.now();
        scheduleAutoSave();

        res.json({ success: true, message: 'Trade rejected', trade: trade });
    });

    app.get('/api/player/:player/achievements', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        ensureMetaState(gameState);

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const unlockedIds = gameState.playerProgress[player].achievements || [];
        const unlocked = (gameState.achievements || []).filter(a => unlockedIds.includes(a.id));
        res.json({ unlocked, unlockedIds, all: gameState.achievements || [] });
    });

    app.get('/api/team-objective', (req, res) => {
        const gameState = getGameState();
        ensureMetaState(gameState);
        res.json({ active: gameState.activeTeamObjective || null });
    });

    app.post('/api/team-objective/start-random', (req, res) => {
        const gameState = getGameState();
        ensureMetaState(gameState);
        const pool = gameState.teamObjectives || [];
        if (pool.length === 0) {
            return res.status(400).json({ error: 'No team objectives configured' });
        }

        const objective = pool[Math.floor(Math.random() * pool.length)];
        gameState.activeTeamObjective = {
            ...objective,
            startedAt: new Date().toISOString(),
            contributors: {}
        };

        Object.keys(gameState.players || {}).forEach((playerKey) => {
            gameState.activeTeamObjective.contributors[playerKey] = false;
            gameState.playerProgress[playerKey].teamContribution = false;
        });

        scheduleAutoSave();
        res.json({ success: true, objective: gameState.activeTeamObjective });
    });

    app.post('/api/player/:player/team-objective/contribute', (req, res) => {
        const { player } = req.params;
        const gameState = getGameState();
        ensureMetaState(gameState);

        if (!gameState.players[player]) {
            return res.status(404).json({ error: 'Player not found' });
        }

        const objective = gameState.activeTeamObjective;
        if (!objective) {
            return res.status(400).json({ error: 'No active team objective' });
        }

        const wasAlreadyContributor = Boolean(objective.contributors[player]);
        objective.contributors[player] = true;
        gameState.playerProgress[player].teamContribution = true;
        if (!wasAlreadyContributor) {
            gameState.playerProgress[player].teamObjectiveContributions += 1;
        }

        const everyoneContributed = Object.keys(gameState.players || {}).every(p => Boolean(objective.contributors[p]));
        let completion = null;
        if (everyoneContributed) {
            const outcome = resolveTeamObjectiveDiceOutcome(gameState, objective);
            completion = {
                objectiveId: objective.id,
                objectiveName: objective.name,
                reward: objective.reward || {},
                outcome
            };
            gameState.activeTeamObjective = null;
        }

        const unlockedAchievements = evaluateAchievements(gameState, player);

        scheduleAutoSave();
        res.json({
            success: true,
            contributed: true,
            everyoneContributed,
            completion,
            achievementsUnlocked: unlockedAchievements.map(a => ({ id: a.id, name: a.name })),
            activeTeamObjective: gameState.activeTeamObjective
        });
    });

    app.get('/api/event-cards', (req, res) => {
        const gameState = getGameState();
        res.json(gameState.eventCards || []);
    });

    app.post('/api/event-cards/draw', (req, res) => {
        const gameState = getGameState();
        ensureMetaState(gameState);
        const cards = gameState.eventCards || [];
        if (cards.length === 0) {
            return res.status(400).json({ error: 'No event cards configured' });
        }

        const card = cards[Math.floor(Math.random() * cards.length)];
        const effect = card.effect || {};

        Object.keys(gameState.players || {}).forEach((playerKey) => {
            const playerData = gameState.players[playerKey];
            if (effect.rads) {
                applyRadGainWithPerks(playerData, Number(effect.rads));
            }
            if (effect.hp) {
                if (Number(effect.hp) >= 0) {
                    applyHealingWithPerks(playerData, Number(effect.hp));
                } else {
                    applyHpLossWithPerks(playerData, Math.abs(Number(effect.hp)));
                }
            }
            if (effect.tabs) {
                applyTabsGain(playerData, Number(effect.tabs));
            }
            if (effect.randomScrap) {
                const randomScrap = applyRandomScrapGain(playerData, Number(effect.randomScrap));
                if (randomScrap) {
                    gameState.sessionMetrics.scrapGained[playerKey] = (gameState.sessionMetrics.scrapGained[playerKey] || 0) + randomScrap.amount;
                }
            }

            playerData.activeRadioData = {
                id: `event_${Date.now()}`,
                title: `EVENT CARD: ${card.name}`,
                text: card.text,
                type: 'event-card'
            };
            playerData.activeRadio = null;
        });

        scheduleAutoSave();
        res.json({ success: true, card });
    });

    app.get('/api/session/recap', (req, res) => {
        const gameState = getGameState();
        const recap = buildSessionRecap(gameState);
        scheduleAutoSave();
        res.json(recap);
    });

    app.post('/api/reset', (req, res) => {
        setGameState(createInitialGameState());
        scheduleAutoSave();
        res.json({ success: true, message: 'Game data reset to initial state' });
    });
}

module.exports = registerGameplayRoutes;
