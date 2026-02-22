# FALLOUT: NEW NOVA SCOTIA - GAME MASTER SYSTEM

## 🎮 Setup & Installation

### Requirements
- Node.js (v14+) - Download from https://nodejs.org
- 3 devices on the same WiFi network (GM computer + 2 player devices)

### Installation Steps

1. **Install Node.js dependencies**
```bash
cd g:\My Drive\fallout
npm install
```

2. **Start the server** (from GM's computer)
```bash
node server.js
```

You'll see output like:
```
╔════════════════════════════════════════════════════════════╗
║  FALLOUT: NEW NOVA SCOTIA - GAME MASTER SERVER STARTED    ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  📊 GM DASHBOARD:                                          ║
║  http://192.168.x.x:5000/gm-dashboard.html               ║
║                                                            ║
║  👤 LOGAN:                                                 ║
║  http://192.168.x.x:5000/player.html?player=logan        ║
║                                                            ║
║  👤 RYLYN:                                                 ║
║  http://192.168.x.x:5000/player.html?player=rylyn        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

3. **On the GM's computer**
   - Open browser to: `http://localhost:5000/gm-dashboard.html`
   - Click "QR CODES" tab to see player links

4. **On player devices (Logan's device)**
   - Scan Logan's QR code OR
   - Navigate to: `http://192.168.x.x:5000/player.html?player=logan`

5. **On player devices (Rylyn's device)**
   - Scan Rylyn's QR code OR
   - Navigate to: `http://192.168.x.x:5000/player.html?player=rylyn`

## ☁️ Deploy on Render

1. Push this project to GitHub.
2. In Render, create a **Web Service** from that repo.
3. Use these settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Deploy, then open:
   - `https://<your-service>.onrender.com/gm-dashboard.html`
   - `https://<your-service>.onrender.com/player.html?player=logan`
   - `https://<your-service>.onrender.com/player.html?player=rylyn`

Notes:
- The app now uses Render's `PORT` automatically.
- API calls use the same domain as the page, so no manual URL changes are needed.

---

## 🎯 Game Master Controls

### PLAYERS Tab
- Adjust Level, HP, Max HP, Rads, Caps for each player
- Grant scrap materials (Wood, Steel, Circuit, Adhesive)

### QUESTS Tab
- Send quests to Logan or Rylyn
- View each player's active quests
- Quests auto-reward tabs and XP when completed

### RADIO Tab
- Broadcast radio signals to each player
- Players see signals on their RADIO tab with flavor text

### TRADES Tab
- Configure NPC vendors and trade offers (future expansion)

### QR CODES Tab
- Display scannable QR codes for instant player connections
- Direct HTTP links also available

---

## 📱 Player Interface Features

Players see real-time updates (polls every 2 seconds):

### STATUS Tab
- Character class and level
- Health and radiation bars
- Current caps and faction
- Stats display (CHAPPY)

### QUESTS Tab
- All active quest contracts
- Quest descriptions and rewards
- Shows tabs earned per quest

### CRAFTING Tab
- Inventory of scrap materials
- Available recipes
- Shows material requirements

### RADIO Tab
- Receives live radio broadcasts from GM
- Displays signal title and flavor text
- Alerts when new signals arrive

### QUARTERS Tab (Home Improvement Catalog)
- Browse and purchase vault upgrades
- Spend Pop Tabs to customize your personal quarters
- Installed upgrades apply stat bonuses immediately
- Shows upgrade descriptions and effects

---

## 🔄 Data Sync Details

- **Polling Interval**: 2 seconds
- **Backend**: Express.js (Node.js)
- **Data Storage**: Auto-saved to `game-state.json` on each state-changing action
- **Network**: Local WiFi only (no internet required)

Auto-save notes:
- State is loaded from `game-state.json` on server start.
- State is saved automatically after player/GM changes (quests, stats, perks, crafting, upgrades, etc.).
- On Render free web services, local disk can be ephemeral between deploys/restarts, so use an external DB for permanent cloud saves.

---

## 🛠️ File Structure

```
g:\My Drive\fallout\
├── server.js               # Express server (start this)
├── gm-dashboard.html       # GM control panel
├── player.html             # Player interface (both players use)
├── falloutnovascotia.html  # Solo game version
└── README.md              # This file
```

---

## ⚡ Quick Start Checklist

- [ ] Node.js installed
- [ ] Dependencies: `npm install express cors`
- [ ] Server running: `node server.js`
- [ ] GM dashboard open on computer
- [ ] Logan's device scanned/connected
- [ ] Rylyn's device scanned/connected
- [ ] Test: Send a quest from GM to a player
- [ ] Test: Send a radio signal
- [ ] Test: Modify player stats

---

## 🔗 API Endpoints (for reference)

### GM Endpoints
- `POST /api/player/:player/stat/:stat` - Update player stat
- `POST /api/player/:player/quest` - Send quest
- `POST /api/player/:player/radio` - Send radio signal
- `POST /api/player/:player/scrap/:type` - Grant scrap
- `POST /api/player/:player/complete-quest` - Complete quest
- `GET /api/game-state` - Get full game state

### Player Endpoints
- `GET /api/player/:player` - Get player data
- `GET /api/quests` - Get all quests
- `GET /api/radio` - Get all radio signals
- `GET /api/recipes` - Get all recipes
- `GET /api/trades` - Get trade offers
- `POST /api/player/:player/craft/:recipeId` - Craft an item

### Perk Endpoints
- `GET /api/perks` - Get all perks
- `GET /api/player/:player/perks` - Get player's unlocked perks
- `POST /api/player/:player/perk/:perkId` - Unlock perk
- `DELETE /api/player/:player/perk/:perkId` - Remove perk

### Quarters/Home Upgrade Endpoints
- `GET /api/quarters-shop` - Get all available vault upgrades
- `GET /api/player/:player/quarters` - Get player's purchased upgrades
- `POST /api/player/:player/quarters/:upgradeId` - Purchase a vault upgrade

---

## 🧱 Scrap Categories & Recipes

### New Scrap Materials
- **Maritime Metal**: Rusted lobster traps, bridge cables, corrugated siding (armor/melee)
- **Synthetic Sap**: Mutated evergreens, old syrup buckets (adhesive/crafting)
- **Hub Circuitry**: Tech sector ruins, Debert Bunker salvage (high-tech mods)
- **Plaid Scraps**: Shredded flannel and heavy wool (environmental protection)
- **Propane Tank**: Industrial salvage (explosives)
- **Rad-Meat**: Mutant meat (food)
- **Spices**: Edible seasonings (food)
- **Clean Water**: Filtered or purified water (food hydration)

### Nova Scotia Blueprints (Craftable Items)

| Recipe | Ingredients | Effect |
|--------|-------------|---------|
| **Bluenose Bayonet** | Maritime Metal x2 + Hockey Stick | Reach weapon, extra damage to Rad-Skeeters |
| **Trapper's Plate** | Maritime Metal x4 + Plaid Scraps x2 | High armor, immune to Red Mud agility penalty |
| **Propane Popper** | Propane Tank + Synthetic Sap x2 | Fire AOE grenade, clears swarms |
| **Donair-Dab Kit** | Rad-Meat + Spices + Clean Water | Heals 50% HP, +10 RADS* (*unless LEAD BELLY perk) |
| **Stimpak** | Synthetic Sap x1 | Restores 4 HP |
| **Rad-Away** | Synthetic Sap x2 | Removes 2 Rads |

### Personal Vault - Home Upgrades (Quarters Shop)

Players can spend Pop Tabs to upgrade their personal vault quarters with rare items found in the wasteland.

| Upgrade | Tier | Cost | Effect |
|---------|------|------|--------|
| **STRUCTURAL REINFORCEMENT** | 1 | 50 TABS | +1 Hardiness - Reinforced tent walls resist Room-Draft Rad-storms |
| **TACTICAL LUMENS** | 1 | 75 TABS | +1 Perception - Fairy lights prevent nighttime accidents |
| **SOFT-FLOOR PROTOCOL** | 1 | 100 TABS | Full HP Recovery - Cushy flooring for restorative sleep |
| **SALVAGED SUPPLY BIN** | 1 | 60 TABS | +3 Inventory Slots - Extra storage without carry weight penalties |
| **DELTA MASCOT POSTER** | 1 | 45 TABS | +1 Charm - Company mascot boosts morale and faction negotiation |
| **AIR-LOCK SEALANT** | 1 | 40 TABS | Skeeter Immunity - Sealed vault provides refuge from Rad-Skeeter Swarms |
| **RATION DISPENSER** | 1 | 80 TABS | Fortified Recovery - Pre-war snacks grant +1 Hardiness per Encounter |
| **SCRAP-COMMS LINK** | 1 | 100 TABS | Assist Bonus - Once per session, get +1 to any C.H.A.P.P.Y. roll from other survivor |

---

## � Immersive Wasteland Encounters (Real-World Quests)

These quests blend the digital game world with physical challenges in your home.

| Quest | Description | Reward | Challenge |
|-------|-------------|--------|-----------|
| **The Tidal Bore Race** | Gather all Scrap before tidal surge! 5-minute timer. | 50 TABS | Race against the clock to evacuate |
| **The Plaid Patch-Up** | Find Plaid Scrap and tape up the Vault air-lock. | 35 TABS | Requires Synthetic Sap to seal |
| **Three-Crows Signal Boost** | Recite "Wasteland Oath" from highest peak for 60 sec. | 20 TABS | Unlocks new radio track + teamwork |
| **The Junk-Jet Prototype** | Collect 5 Scrap pieces from different rooms. | 60 TABS | Must justify each piece's use |
| **Five Islands: The Great Drain** | Master the Mud-Slog and survive the Tidal Rush. | 55 TABS | Physical endurance + speed |
| **Shubenacadie: Beast Pens** | Scout and photograph 3 Wasteland Creatures. | 50 TABS | Stealth and observation skills |

### Radio Broadcasts

When the GM sends these quests, they're accompanied by immersive radio signals:
- **TIDAL BORE WARNING**: Urgent alert! 5-minute evacuation countdown
- **PLAID PATCH ALERT**: Vault sealed failed. Air-lock compromised
- **SIGNAL BOOST REQUEST**: Three-Crows signal fading. Need Signal Flare
- **JUNK-JET BROADCAST**: Scrap collection needed for prototype
- **GREAT DRAIN LOCATION**: Five Islands Park coordinates locked
- **BEAST PENS SIGHTING**: Rad-Moose and Yao Guai variants detected

---

## �🎲 Example Game Session

1. **GM sends quest to Logan**: "Battle for the Bazaar"
2. **Logan sees quest appear** on QUESTS tab (within 2 seconds)
3. **GM broadcasts radio**: "HIGHWAY 104 RAIDERS ALERT"
4. **Both players receive radio signal** on RADIO tab
5. **GM grants scrap**: Logan receives 5 wood, 3 steel
6. **Logan checks inventory** and sees updated scrap counts
7. **GM completes quest for Logan**: Quest completes, tabs reward given
8. **Logan sees level up and new tabs** on next sync

---

## 🆘 Troubleshooting

**Q: Players can't connect**
- Check IP address from server output
- Ensure all devices on same WiFi
- Verify firewall allows port 5000

**Q: QR codes don't work**
- Make sure your IP matches the server output
- Test direct URL first: `http://192.168.x.x:5000/player.html?player=logan`

**Q: Data not updating**
- Check server console for errors
- Reload browser tab
- Verify server is still running

**Q: Need to save progress**
- Currently in-memory (resets on server restart)
- Export player data manually from GM dashboard (future feature)

---

## 📝 Notes for Game Masters

- Keep GM dashboard on main screen for quest/radio control
- Player screens auto-update every 2 seconds
- QR codes can be printed or displayed via projector
- Consider having backup URLs written down
- Server must remain running for all connections to work

Enjoy your Fallout: New Nova Scotia campaign! 🎉
