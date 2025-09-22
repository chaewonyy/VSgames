document.addEventListener('DOMContentLoaded', () => {
    const DPR = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // === DOM & UI SETUP =============================================
    const ui = {
        timer: document.getElementById('timer'),
        hpBar: document.getElementById('hp-bar'),
        hpText: document.getElementById('hp-text'),
        levelText: document.getElementById('level-text'),
        xpBar: document.getElementById('xp-bar'),
        startScreen: document.getElementById('start-screen'),
        pauseScreen: document.getElementById('pause-screen'),
        levelUpScreen: document.getElementById('level-up-screen'),
        gameOverScreen: document.getElementById('game-over-screen'),
        winScreen: document.getElementById('win-screen'),
        upgradeOptions: document.getElementById('upgrade-options'),
        finalTime: document.getElementById('final-time'),
        startButton: document.getElementById('start-button'),
        restartButtonGameOver: document.getElementById('restart-button-gameover'),
        restartButtonWin: document.getElementById('restart-button-win'),
        upgradeDisplay: null, // Will be created dynamically
    };

    function createUpgradeDisplay() {
        const display = document.createElement('div');
        display.id = 'upgrade-display';
        document.getElementById('ui-layer').appendChild(display);
        ui.upgradeDisplay = display;
    }
    createUpgradeDisplay();

    [ui.startScreen, ui.pauseScreen, ui.levelUpScreen, ui.gameOverScreen, ui.winScreen].forEach(screen => {
        const panel = document.createElement('div');
        panel.className = 'overlay-panel';
        while (screen.firstChild) { panel.appendChild(screen.firstChild); }
        screen.appendChild(panel);
    });

    // === CONFIGURATION CONSTANTS =============================================
    const CANVAS_SCALE = 1.5;
    const ASSET_PATHS = {
        player: 'assets/player/hero.png',
        enemy: 'assets/enemy/enemy.png',
        bg: 'assets/bg/grass_tile.png',
        weapon: 'assets/weapon/weapon.png',
        gem: 'assets/gem/gem.png'
    };

    const BG_CONFIG = { EXTRA_SCALE: 1.0, SMOOTHING_ENABLED: true };
    const HP_BAR_CONFIG = { WIDTH_MULTIPLIER: 1.8, HEIGHT: 10, Y_OFFSET: 20, BG_COLOR: 'rgba(0,0,0,0.6)', FILL_COLOR: '#4CAF50', OUTLINE_COLOR: '#222' };
    const SCALE_FACTORS = { PLAYER: 4, ENEMY: 4, PROJECTILE: 3 };
    const VISUAL_SCALES = { WEAPON: 2.0, GEM: 2.0 };
    const COLLISION_CONFIG = { HITBOX_SCALE: 0.35 };

    const GAME_CONFIG = {
        WIN_TIME_SECONDS: 600,
        PLAYER: { BASE_SPEED: 270, RADIUS: 12 * SCALE_FACTORS.PLAYER, MAX_HP: 100, IFRAME_DURATION: 650, BASE_DAMAGE: 10, PROJ_SPEED: 360, PROJ_COOLDOWN: 900 },
        ENEMY: { BASE_SPEED: 85, BASE_HP: 20, CONTACT_DAMAGE: 10, RADIUS: 12 * SCALE_FACTORS.ENEMY },
        SPAWN: { INITIAL_INTERVAL: 1.2, MIN_INTERVAL: 0.12, INTERVAL_DECREASE_RATE: 0.0016, HP_SCALE_RATE: 0.015, SPEED_SCALE_RATE: 0.002, EASY_MODE_UNTIL: 90, EASY_MODE_MULTIPLIER: 0.8, HARD_MODE_FROM: 300, HARD_MODE_MULTIPLIER: 1.1, VERY_HARD_MODE_FROM: 480, VERY_HARD_MODE_MULTIPLIER: 1.25 },
        XP_GEM: { DROP_CHANCE: 1.0, MIN_XP: 1, MAX_XP: 3, RADIUS: 10, PICKUP_RADIUS: 60, MAGNET_RADIUS: 150, MAGNET_SPEED: 480 }, // Gem radius increased
        LEVELING: { BASE_XP: 5, XP_PER_LEVEL: 1.8, XP_POWER: 1.35, XP_POWER_SCALE: 0.6 },
    };

    // === WEAPON AND UPGRADE DEFINITIONS =================================
    const weapons = {
        straight: {
            name: "기본 단발",
            fire(player) {
                const closestEnemy = findClosestEnemy(player);
                if (!closestEnemy) return;
                const proj = getFromPool(projectilePool);
                proj.x = player.x; proj.y = player.y;
                proj.radius = 6 * SCALE_FACTORS.PROJECTILE;
                proj.damage = player.damage;
                proj.pierce = player.pierce; proj.chain = player.chain;
                proj.hitEnemies = new Set();
                proj.speed = player.projSpeed;
                const angle = Math.atan2(closestEnemy.y - player.y, closestEnemy.x - player.x);
                proj.vx = Math.cos(angle) * proj.speed;
                proj.vy = Math.sin(angle) * proj.speed;
                projectiles.push(proj);
            }
        },
    };

    const allUpgrades = [
        // --- Attack ---
        { id: 'damage', name: '공격력 +15%', desc: '모든 공격의 피해량이 15% 증가합니다.', type: 'attack', rarity: 'common', maxLevel: 5, apply: (p) => p.damage *= 1.15 },
        { id: 'cooldown', name: '공격 속도 +12%', desc: '공격 쿨타임이 12% 감소합니다.', type: 'attack', rarity: 'common', maxLevel: 5, apply: (p) => p.projCooldown *= 0.88 },
        { id: 'projCount', name: '투사체 개수 +1', desc: '한 번에 발사하는 투사체 수를 늘립니다.', type: 'attack', rarity: 'epic', maxLevel: 2, apply: (p) => p.projCount += 1 },
        { id: 'critMult', name: '크리티컬 배수 +50%', desc: '크리티컬 피해량이 50% 증가합니다.', type: 'attack', rarity: 'epic', maxLevel: 2, apply: (p) => p.critMult += 0.5 },
        { id: 'areaScale', name: '범위 +15%', desc: '공격 범위와 크기가 증가합니다.', type: 'attack', rarity: 'rare', maxLevel: 3, apply: (p) => p.areaScale *= 1.15 },

        // --- Defense/Mobility ---
        { id: 'maxHp', name: '최대 체력 +25', desc: '최대 체력이 25 증가하고 모두 회복합니다.', type: 'defense', rarity: 'common', maxLevel: 5, apply: (p) => { p.maxHp += 25; p.hp = p.maxHp; } },
        { id: 'speed', name: '이동 속도 +10%', desc: '이동 속도가 10% 빨라집니다.', type: 'defense', rarity: 'common', maxLevel: 4, apply: (p) => p.speed *= 1.10 },
        { id: 'shield', name: '보호막 +40', desc: '피해를 흡수하는 보호막을 얻습니다. 레벨업 시 재충전됩니다.', type: 'defense', rarity: 'rare', maxLevel: 3, apply: (p) => p.shield += 40 },
        { id: 'thorns', name: '가시 피해 +4', desc: '피격 시 적에게 4의 피해를 되돌려줍니다.', type: 'defense', rarity: 'rare', maxLevel: 3, apply: (p) => { p.upgrades.thorns = { value: (p.upgrades.thorns?.value || 0) + 4 }; } },

        // --- Utility ---
        { id: 'magnetBonus', name: '자석 반경 +60', desc: '경험치 보석을 끌어당기는 범위가 넓어집니다.', type: 'utility', rarity: 'common', maxLevel: 3, apply: (p) => p.magnetBonus += 60 },
        { id: 'xpGainMult', name: '경험치 획득 +15%', desc: '얻는 경험치의 양이 15% 증가합니다.', type: 'utility', rarity: 'rare', maxLevel: 4, apply: (p) => p.xpGainMult += 0.15 },
        { id: 'reroll', name: '리롤 +1', desc: '레벨업 시 선택지를 다시 뽑을 수 있습니다. (R키)', type: 'utility', rarity: 'common', maxLevel: 3, apply: (p) => p.reroll += 1 },
        { id: 'banish', name: '추방 +1', desc: '원하지 않는 업그레이드를 목록에서 제거합니다. (B키)', type: 'utility', rarity: 'epic', maxLevel: 3, apply: (p) => p.banish += 1 },

        // --- Special ---
        { id: 'lifesteal', name: '흡혈', desc: '적 처치 시 체력을 2 회복합니다.', type: 'special', rarity: 'legend', maxLevel: 1, apply: (p) => p.lifesteal += 2 },
        { id: 'elite_magnet', name: '엘리트 자석', desc: '강한 적이 더 좋은 보상을 줄 확률이 높아집니다.', type: 'special', rarity: 'legend', maxLevel: 1, apply: (p) => { /* Logic to be implemented */ } },
    ];

    const IMAGES = { player: null, enemy: null, bg: null, weapon: null, gem: null };
    async function loadAssets() {
        ctx.imageSmoothingEnabled = BG_CONFIG.SMOOTHING_ENABLED;
        await Promise.all(Object.entries(ASSET_PATHS).map(([key, src]) => 
            new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => { IMAGES[key] = img; resolve(); };
                img.onerror = (e) => { console.error(`Failed to load image: ${src}`); reject(e); };
                img.src = src;
            })
        ));
    }

    function drawCoverBackground() {
        const logicalWidth = canvas.width / (CANVAS_SCALE * DPR);
        const logicalHeight = canvas.height / (CANVAS_SCALE * DPR);
        if (!IMAGES.bg) { ctx.fillStyle = '#a6d48f'; ctx.fillRect(0, 0, logicalWidth, logicalHeight); return; }
        const imgWidth = IMAGES.bg.width, imgHeight = IMAGES.bg.height;
        const scale = Math.max(logicalWidth / imgWidth, logicalHeight / imgHeight) * BG_CONFIG.EXTRA_SCALE;
        const scaledWidth = imgWidth * scale, scaledHeight = imgHeight * scale;
        const x = (logicalWidth - scaledWidth) / 2, y = (logicalHeight - scaledHeight) / 2;
        ctx.drawImage(IMAGES.bg, Math.round(x), Math.round(y), Math.round(scaledWidth), Math.round(scaledHeight));
    }

    function drawCenteredSprite(img, x, y, radius, scale = 2.2) {
        if (!img) return;
        const targetSize = radius * scale;
        const aspect = img.width / img.height;
        let dw = targetSize, dh = targetSize;
        if (aspect >= 1) dh = targetSize / aspect; else dw = targetSize * aspect;
        ctx.drawImage(img, Math.round(x - dw / 2), Math.round(y - dh / 2), Math.round(dw), Math.round(dh));
    }

    function drawEnemyHpBar(enemy) {
        const barWidth = enemy.radius * HP_BAR_CONFIG.WIDTH_MULTIPLIER;
        const barHeight = HP_BAR_CONFIG.HEIGHT;
        const x = Math.round(enemy.x - barWidth / 2);
        const y = Math.round(enemy.y - enemy.radius - HP_BAR_CONFIG.Y_OFFSET);
        const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
        ctx.fillStyle = HP_BAR_CONFIG.BG_COLOR; ctx.fillRect(x, y, barWidth, barHeight);
        ctx.fillStyle = HP_BAR_CONFIG.FILL_COLOR; ctx.fillRect(x, y, barWidth * hpRatio, barHeight);
        ctx.strokeStyle = HP_BAR_CONFIG.OUTLINE_COLOR; ctx.lineWidth = 2; ctx.strokeRect(x, y, barWidth, barHeight);
    }

    let gameState = 'START', gameTime = 0, lastTime = 0, keys = {};
    let player, enemies = [], projectiles = [], xpGems = [], orbitals = [];
    const projectilePool = [], enemyPool = [], xpGemPool = [];
    const MAX_POOL_SIZE = 400;

    function resizeCanvas() {
        const cssWidth = window.innerWidth, cssHeight = window.innerHeight;
        canvas.style.width = cssWidth + 'px'; canvas.style.height = cssHeight + 'px';
        canvas.width = Math.round(cssWidth * DPR); canvas.height = Math.round(cssHeight * DPR);
        ctx.resetTransform(); ctx.scale(CANVAS_SCALE * DPR, CANVAS_SCALE * DPR);
        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer) { uiLayer.style.width = cssWidth + 'px'; uiLayer.style.height = cssHeight + 'px'; }
        if (IMAGES.bg) { drawCoverBackground(); }
    }

    function initPools() {
        for (let i = 0; i < MAX_POOL_SIZE; i++) {
            projectilePool.push({ active: false });
            enemyPool.push({ active: false });
            xpGemPool.push({ active: false });
        }
    }
    
    function getFromPool(pool) {
        const item = pool.find(i => !i.active);
        if (item) { item.active = true; return item; }
        const newItem = { active: true }; pool.push(newItem); return newItem;
    }

    function returnToPool(item) { item.active = false; }

    function init() {
        gameTime = 0; lastTime = 0;
        const logicalWidth = canvas.width / (CANVAS_SCALE * DPR);
        const logicalHeight = canvas.height / (CANVAS_SCALE * DPR);

        player = {
            x: logicalWidth / 2, y: logicalHeight / 2,
            radius: GAME_CONFIG.PLAYER.RADIUS,
            hp: GAME_CONFIG.PLAYER.MAX_HP, maxHp: GAME_CONFIG.PLAYER.MAX_HP,
            speed: GAME_CONFIG.PLAYER.BASE_SPEED,
            iFrameUntil: 0, level: 1, xp: 0,
            nextLevelXp: calculateNextLevelXp(1),
            projSpeed: GAME_CONFIG.PLAYER.PROJ_SPEED,
            projCooldown: GAME_CONFIG.PLAYER.PROJ_COOLDOWN,
            damage: GAME_CONFIG.PLAYER.BASE_DAMAGE,
            lastShotTime: 0,
            
            critChance: 0.05, critMult: 1.5,
            pierce: 0, chain: 0, knockback: 0,
            areaScale: 1.0,
            status: { burn: { chance: 0, dps: 0, dur: 0 }, freeze: { chance: 0, slow: 0, dur: 0 }, poison: { chance: 0, dps: 0, dur: 0 } },
            lifesteal: 0, shield: 0,
            dashCooldown: 2.5, dashReadyAt: 0, dashSpeed: 700, dashDuration: 0.15, isDashing: false, dashUntil: 0,
            magnetBonus: 0, xpGainMult: 1.0,
            reroll: 0, banish: 0,
            weapon: "straight",
            upgrades: {},
            bannedUpgrades: new Set(),
        };

        [...enemies, ...projectiles, ...xpGems, ...orbitals].forEach(o => o.active = false);
        enemies = []; projectiles = []; xpGems = []; orbitals = [];
        enemySpawnTimer = GAME_CONFIG.SPAWN.INITIAL_INTERVAL;
        updateUI();
        updateUpgradeDisplay();
    }

    function calculateNextLevelXp(level) {
        const { BASE_XP, XP_PER_LEVEL, XP_POWER, XP_POWER_SCALE } = GAME_CONFIG.LEVELING;
        return Math.floor(BASE_XP + level * XP_PER_LEVEL + Math.pow(level, XP_POWER) * XP_POWER_SCALE);
    }

    window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyP') {
            if (gameState === 'PLAYING') { gameState = 'PAUSED'; ui.pauseScreen.style.display = 'flex'; } 
            else if (gameState === 'PAUSED') { gameState = 'PLAYING'; ui.pauseScreen.style.display = 'none'; requestAnimationFrame(gameLoop); }
        }
        if (gameState === 'LEVEL_UP') {
            if (e.code === 'Digit1' || e.code === 'Numpad1') selectUpgrade(0);
            if (e.code === 'Digit2' || e.code === 'Numpad2') selectUpgrade(1);
            if (e.code === 'Digit3' || e.code === 'Numpad3') selectUpgrade(2);
            if (e.code === 'KeyR') rerollUpgrades();
            if (e.code === 'KeyB') toggleBanishMode();
        }
        if (e.code === 'KeyQ' && player.upgrades.dash && !player.isDashing && Date.now() >= player.dashReadyAt) {
            player.isDashing = true;
            player.dashUntil = Date.now() + player.dashDuration * 1000;
            player.iFrameUntil = player.dashUntil;
        }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

    function update(dt) {
        if (gameState !== 'PLAYING') return;
        gameTime += dt;

        const logicalWidth = canvas.width / (CANVAS_SCALE * DPR);
        const logicalHeight = canvas.height / (CANVAS_SCALE * DPR);

        let dx = 0, dy = 0;
        if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

        if (player.isDashing) {
            if (Date.now() >= player.dashUntil) {
                player.isDashing = false;
                player.dashReadyAt = Date.now() + player.dashCooldown * 1000;
            } else {
                const magnitude = Math.sqrt(dx * dx + dy * dy) || 1;
                player.x += (dx / magnitude) * player.dashSpeed * dt;
                player.y += (dy / magnitude) * player.dashSpeed * dt;
            }
        } else if (dx !== 0 || dy !== 0) {
            const magnitude = Math.sqrt(dx * dx + dy * dy);
            player.x += (dx / magnitude) * player.speed * dt;
            player.y += (dy / magnitude) * player.speed * dt;
        }
        player.x = Math.max(player.radius, Math.min(logicalWidth - player.radius, player.x));
        player.y = Math.max(player.radius, Math.min(logicalHeight - player.radius, player.y));

        if (Date.now() - player.lastShotTime > player.projCooldown) {
            const weapon = weapons[player.weapon];
            if (weapon && weapon.fire) {
                weapon.fire(player);
                player.lastShotTime = Date.now();
            }
        }

        updateProjectiles(dt, logicalWidth, logicalHeight);
        updateEnemySpawning(dt);
        updateEnemies(dt);
        updateGems(dt);
        handleCollisions();
        
        if (player.hp <= 0) {
            gameState = 'GAME_OVER';
            ui.gameOverScreen.querySelector('#final-time').textContent = formatTime(gameTime);
            ui.gameOverScreen.style.display = 'flex';
        }
        if (gameTime >= GAME_CONFIG.WIN_TIME_SECONDS) {
            gameState = 'WIN';
            ui.winScreen.style.display = 'flex';
        }
        updateUI();
    }
    
    let enemySpawnTimer = GAME_CONFIG.SPAWN.INITIAL_INTERVAL;
    function updateEnemySpawning(dt) {
        enemySpawnTimer -= dt;
        if (enemySpawnTimer <= 0) {
            const t = gameTime;
            const { INITIAL_INTERVAL, MIN_INTERVAL, INTERVAL_DECREASE_RATE } = GAME_CONFIG.SPAWN;
            let interval = Math.max(MIN_INTERVAL, INITIAL_INTERVAL - INTERVAL_DECREASE_RATE * t);
            let multiplier = 1;
            if (t < GAME_CONFIG.SPAWN.EASY_MODE_UNTIL) multiplier = GAME_CONFIG.SPAWN.EASY_MODE_MULTIPLIER;
            else if (t >= GAME_CONFIG.SPAWN.VERY_HARD_MODE_FROM) multiplier = GAME_CONFIG.SPAWN.VERY_HARD_MODE_MULTIPLIER;
            else if (t >= GAME_CONFIG.SPAWN.HARD_MODE_FROM) multiplier = GAME_CONFIG.SPAWN.HARD_MODE_MULTIPLIER;
            spawnEnemy();
            enemySpawnTimer = interval / multiplier;
        }
    }

    function updateProjectiles(dt, logicalWidth, logicalHeight) {
        projectiles = projectiles.filter(p => {
            if (!p.active) return false;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.x < -100 || p.x > logicalWidth + 100 || p.y < -100 || p.y > logicalHeight + 100) {
                returnToPool(p);
                return false;
            }
            return true;
        });
    }

    function updateEnemies(dt) {
        enemies.forEach(e => {
            if (!e.active) return;
            
            let currentSpeed = e.baseSpeed;
            let slowEffect = e.statusEffects.find(ef => ef.type === 'freeze');
            if (slowEffect) { currentSpeed *= (1 - slowEffect.slow); }

            const angle = Math.atan2(player.y - e.y, player.x - e.x);
            e.x += Math.cos(angle) * currentSpeed * dt;
            e.y += Math.sin(angle) * currentSpeed * dt;

            const now = Date.now();
            e.statusEffects = e.statusEffects.filter(effect => {
                if (now > effect.endTime) return false;
                if (now > effect.lastTick + 1000) {
                    player.hp = Math.min(player.maxHp, player.hp + (e.hp > 0 ? 0 : player.lifesteal));
                    e.hp -= effect.dps;
                    effect.lastTick = now;
                }
                return true;
            });
            if (e.hp <= 0 && !e.isDying) {
                e.isDying = true;
                spawnXpGem(e.x, e.y);
                returnToPool(e);
            }
        });
        enemies = enemies.filter(e => e.active);
    }

    function spawnEnemy() {
        const enemy = getFromPool(enemyPool);
        const radius = GAME_CONFIG.ENEMY.RADIUS;
        const logicalWidth = canvas.width / (CANVAS_SCALE * DPR);
        const logicalHeight = canvas.height / (CANVAS_SCALE * DPR);
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) { enemy.x = Math.random() * logicalWidth; enemy.y = -radius; }
        else if (edge === 1) { enemy.x = logicalWidth + radius; enemy.y = Math.random() * logicalHeight; }
        else if (edge === 2) { enemy.x = Math.random() * logicalWidth; enemy.y = logicalHeight + radius; }
        else { enemy.x = -radius; enemy.y = Math.random() * logicalHeight; }
        
        const t = gameTime;
        const hpScale = 1 + GAME_CONFIG.SPAWN.HP_SCALE_RATE * (t / 10);
        const speedScale = 1 + GAME_CONFIG.SPAWN.SPEED_SCALE_RATE * t;

        enemy.radius = radius;
        const baseHp = GAME_CONFIG.ENEMY.BASE_HP * hpScale;
        enemy.hp = baseHp; enemy.maxHp = baseHp;
        enemy.baseSpeed = GAME_CONFIG.ENEMY.BASE_SPEED * speedScale;
        enemy.damage = GAME_CONFIG.ENEMY.CONTACT_DAMAGE;
        enemy.statusEffects = [];
        enemy.isDying = false;
        enemies.push(enemy);
    }

    function findClosestEnemy(from, exclude = new Set()) {
        return enemies.reduce((closest, enemy) => {
            if (!enemy.active || exclude.has(enemy)) return closest;
            const dist = Math.hypot(from.x - enemy.x, from.y - enemy.y);
            return (dist < closest.dist) ? { dist, enemy } : closest;
        }, { dist: Infinity, enemy: null }).enemy;
    }

    function updateGems(dt) {
        xpGems.forEach(gem => {
            if (!gem.active) return;
            const dx = player.x - gem.x;
            const dy = player.y - gem.y;
            const dist = Math.hypot(dx, dy);
            const magnetRadius = GAME_CONFIG.XP_GEM.MAGNET_RADIUS + player.magnetBonus;

            if (dist <= magnetRadius) {
                const speed = GAME_CONFIG.XP_GEM.MAGNET_SPEED;
                const ux = dx / (dist || 1), uy = dy / (dist || 1);
                gem.x += ux * speed * dt;
                gem.y += uy * speed * dt;
            }
        });
    }

    function handleCollisions() {
        const now = Date.now();

        if (now > player.iFrameUntil) {
            for (const enemy of enemies) {
                if (!enemy.active) continue;
                const threshold = (player.radius + enemy.radius) * COLLISION_CONFIG.HITBOX_SCALE;
                if (Math.hypot(player.x - enemy.x, player.y - enemy.y) < threshold) {
                    const damageTaken = enemy.damage;
                    if (player.shield > 0) {
                        const absorbed = Math.min(player.shield, damageTaken);
                        player.shield -= absorbed;
                    } else {
                        player.hp = Math.max(0, player.hp - damageTaken);
                    }
                    if (player.upgrades.thorns) { enemy.hp -= player.upgrades.thorns.value; }
                    player.iFrameUntil = now + GAME_CONFIG.PLAYER.IFRAME_DURATION;
                    break;
                }
            }
        }

        const processHit = (target, proj, damage) => {
            if (target.hp <= 0) return false;
            target.hp -= damage;
            
            if (player.knockback > 0) {
                const angle = Math.atan2(target.y - proj.y, target.x - proj.x);
                const knockbackForce = player.knockback * (damage / player.damage);
                target.x += Math.cos(angle) * knockbackForce;
                target.y += Math.sin(angle) * knockbackForce;
            }

            for (const key in player.status) {
                const s = player.status[key];
                if (s.chance > 0 && Math.random() < s.chance) {
                    const existing = target.statusEffects.find(ef => ef.type === key);
                    if (existing) { existing.endTime = Math.max(existing.endTime, now + s.dur * 1000); }
                    else { target.statusEffects.push({ type: key, dps: s.dps, slow: s.slow, endTime: now + s.dur * 1000, lastTick: now }); }
                }
            }

            if (target.hp <= 0) {
                player.hp = Math.min(player.maxHp, player.hp + player.lifesteal);
                spawnXpGem(target.x, target.y);
                returnToPool(target);
                return true;
            }
            return false;
        };

        projectiles.forEach(proj => {
            if (!proj.active) return;
            for (const enemy of enemies) {
                if (!enemy.active || proj.hitEnemies.has(enemy)) continue;
                
                const threshold = (proj.radius * player.areaScale + enemy.radius) * COLLISION_CONFIG.HITBOX_SCALE;
                if (Math.hypot(proj.x - enemy.x, proj.y - enemy.y) < threshold) {
                    let damage = proj.damage;
                    if (Math.random() < player.critChance) { damage *= player.critMult; }
                    
                    const killed = processHit(enemy, proj, damage);
                    proj.hitEnemies.add(enemy);

                    if (killed && proj.chain > 0) {
                        const nextTarget = findClosestEnemy(enemy, proj.hitEnemies);
                        if (nextTarget) {
                            const angle = Math.atan2(nextTarget.y - proj.y, nextTarget.x - proj.x);
                            proj.vx = Math.cos(angle) * proj.speed;
                            proj.vy = Math.sin(angle) * proj.speed;
                            proj.chain--;
                        } else { returnToPool(proj); return; }
                    } else if (proj.pierce > 0) {
                        proj.pierce--;
                    } else { returnToPool(proj); return; }
                }
            }
        });
        
        xpGems.forEach(gem => {
            if (!gem.active) return;
            const pickupThreshold = (player.radius + gem.radius + GAME_CONFIG.XP_GEM.PICKUP_RADIUS + player.magnetBonus) * COLLISION_CONFIG.HITBOX_SCALE;
            if (Math.hypot(player.x - gem.x, player.y - gem.y) < pickupThreshold) {
                player.xp += gem.value * player.xpGainMult;
                returnToPool(gem);
                if (player.xp >= player.nextLevelXp) levelUp();
            }
        });
        
        enemies = enemies.filter(e => e.active);
        projectiles = projectiles.filter(p => p.active);
        xpGems = xpGems.filter(g => g.active);
    }
    
    function spawnXpGem(x, y) {
        if (Math.random() > GAME_CONFIG.XP_GEM.DROP_CHANCE) return;
        const gem = getFromPool(xpGemPool);
        gem.x = x; gem.y = y;
        gem.radius = GAME_CONFIG.XP_GEM.RADIUS;
        gem.value = Math.floor(Math.random() * (GAME_CONFIG.XP_GEM.MAX_XP - GAME_CONFIG.XP_GEM.MIN_XP + 1)) + GAME_CONFIG.XP_GEM.MIN_XP;
        xpGems.push(gem);
    }

    function levelUp() {
        gameState = 'LEVEL_UP';
        player.level++;
        const xpOver = player.xp - player.nextLevelXp;
        player.xp = Math.max(0, xpOver);
        player.nextLevelXp = calculateNextLevelXp(player.level);
        player.hp = player.maxHp;
        if (player.shield) {
            const shieldUpgrade = allUpgrades.find(u => u.id === 'shield');
            if (shieldUpgrade) player.shield = (player.upgrades.shield.level || 1) * 40;
        }
        presentUpgradeOptions();
        ui.levelUpScreen.style.display = 'flex';
        if (player.xp >= player.nextLevelXp) {
            setTimeout(levelUp, 200);
        }
    }
    
    let currentUpgradeChoices = [];
    let isBanishMode = false;
    function presentUpgradeOptions() {
        const optionsContainer = ui.upgradeOptions;
        optionsContainer.innerHTML = '';
        currentUpgradeChoices = [];
        isBanishMode = false;

        const controlsHint = document.createElement('div');
        controlsHint.className = 'controls-hint';
        controlsHint.textContent = `R: 리롤 (${player.reroll}) | B: 추방 (${player.banish})`;
        optionsContainer.appendChild(controlsHint);

        const getWeight = (rarity) => ({ common: 60, rare: 25, epic: 12, legend: 3 }[rarity]);
        
        const available = allUpgrades.filter(u => {
            const level = player.upgrades[u.id]?.level || 0;
            if (level >= u.maxLevel) return false;
            if (player.bannedUpgrades.has(u.id)) return false;
            if (u.requires && !u.requires(player)) return false;
            if (u.excludes && u.excludes.some(ex => player.upgrades[ex])) return false;
            return true;
        });

        const weightedPool = available.flatMap(u => Array(getWeight(u.rarity)).fill(u));
        if (weightedPool.length === 0) {
             const card = document.createElement('div');
             card.className = 'upgrade-card';
             card.innerHTML = `<h3>더 이상 업그레이드가 없습니다!</h3><p>자동으로 계속 진행합니다...</p>`;
             optionsContainer.appendChild(card);
             setTimeout(continueGame, 1500); // Automatically continue after a delay
             return;
        }

        const choices = new Set();
        for (let i = 0; i < 3; i++) {
            if (choices.size >= available.length) break;
            let choice;
            do {
                choice = weightedPool[Math.floor(Math.random() * weightedPool.length)];
            } while (choices.has(choice));
            choices.add(choice);
        }
        currentUpgradeChoices = Array.from(choices);
        
        currentUpgradeChoices.forEach((choice, i) => {
            const card = document.createElement('div');
            card.className = 'upgrade-card';
            card.classList.add(`rarity-${choice.rarity}`);
            card.innerHTML = `<h3>${choice.name}</h3><p>${choice.desc}</p>`;
            card.onclick = () => selectUpgrade(i);
            optionsContainer.appendChild(card);
        });
    }
    
    function selectUpgrade(index) {
        if (gameState !== 'LEVEL_UP' || !currentUpgradeChoices[index]) return;
        
        const choice = currentUpgradeChoices[index];
        if (isBanishMode) {
            if (player.banish > 0) {
                player.banish--;
                player.bannedUpgrades.add(choice.id);
                presentUpgradeOptions();
            }
            return;
        }

        choice.apply(player);
        const currentLevel = player.upgrades[choice.id]?.level || 0;
        player.upgrades[choice.id] = { ...choice, level: currentLevel + 1 };
        updateUpgradeDisplay();
        continueGame();
    }

    function rerollUpgrades() { if (player.reroll > 0) { player.reroll--; presentUpgradeOptions(); } }
    function toggleBanishMode() { if (player.banish > 0) { isBanishMode = !isBanishMode; ui.upgradeOptions.classList.toggle('banish-mode', isBanishMode); } }

    function continueGame() {
        ui.levelUpScreen.style.display = 'none';
        ui.upgradeOptions.classList.remove('banish-mode');
        isBanishMode = false;
        if (player.xp < player.nextLevelXp) {
            gameState = 'PLAYING';
            requestAnimationFrame(gameLoop);
        }
    }

    function draw() {
        drawCoverBackground();

        ctx.save();
        ctx.shadowColor = 'yellow';
        ctx.shadowBlur = 15;
        xpGems.forEach(gem => {
            if (!gem.active) return;
            if (IMAGES.gem) {
                drawCenteredSprite(IMAGES.gem, gem.x, gem.y, gem.radius, VISUAL_SCALES.GEM);
            } else {
                ctx.fillStyle = '#86eafc';
                ctx.beginPath();
                ctx.arc(gem.x, gem.y, gem.radius, 0, 2 * Math.PI);
                ctx.fill();
            }
        });
        ctx.restore();
        
        const blinking = (Date.now() < player.iFrameUntil) && (Math.floor(Date.now() / 100) % 2 === 0);
        if (!blinking) {
            if (IMAGES.player) {
                drawCenteredSprite(IMAGES.player, player.x, player.y, player.radius);
            } else {
                ctx.fillStyle = '#ecf0f1';
                ctx.beginPath();
                ctx.arc(player.x, player.y, player.radius, 0, 2 * Math.PI);
                ctx.fill();
            }
        }

        projectiles.forEach(p => p.active && drawCenteredSprite(IMAGES.weapon, p.x, p.y, p.radius * player.areaScale, VISUAL_SCALES.WEAPON));
        enemies.forEach(e => e.active && drawCenteredSprite(IMAGES.enemy, e.x, e.y, e.radius));
        enemies.forEach(e => e.active && e.hp < e.maxHp && drawEnemyHpBar(e));
    }

    function updateUI() {
        ui.timer.textContent = formatTime(gameTime);
        ui.hpBar.style.width = `${(player.hp / player.maxHp) * 100}%`;
        ui.hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
        ui.levelText.textContent = `Lv. ${player.level}`;
        ui.xpBar.style.width = `${(player.xp / player.nextLevelXp) * 100}%`;
    }

    function updateUpgradeDisplay() {
        if (!ui.upgradeDisplay || !player) return;
        ui.upgradeDisplay.innerHTML = '<h4>- 보유 능력 -</h4>';
        const upgrades = Object.values(player.upgrades);
        if (upgrades.length === 0) {
            ui.upgradeDisplay.innerHTML += '<p>없음</p>';
            return;
        }
        const list = document.createElement('ul');
        upgrades.sort((a,b) => a.name.localeCompare(b.name)).forEach(u => {
            const item = document.createElement('li');
            item.textContent = `${u.name} (Lv.${u.level})`;
            list.appendChild(item);
        });
        ui.upgradeDisplay.appendChild(list);
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    function gameLoop(timestamp) {
        if (gameState === 'PAUSED' || gameState === 'LEVEL_UP' || gameState === 'GAME_OVER' || gameState === 'WIN') return;
        const dt = (timestamp - (lastTime || timestamp)) / 1000;
        lastTime = timestamp;
        update(dt);
        draw();
        requestAnimationFrame(gameLoop);
    }
    
    async function startGame() {
        ui.startScreen.style.display = 'none';
        ui.gameOverScreen.style.display = 'none';
        ui.winScreen.style.display = 'none';
        if (!IMAGES.player) { await loadAssets(); }
        gameState = 'PLAYING';
        init();
        requestAnimationFrame(gameLoop);
    }

    ui.startButton.addEventListener('click', startGame);
    ui.restartButtonGameOver.addEventListener('click', startGame);
    ui.restartButtonWin.addEventListener('click', startGame);
    window.addEventListener('resize', resizeCanvas);

    initPools();
    resizeCanvas();
    ui.startScreen.style.display = 'flex';
});
