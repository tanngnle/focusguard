# MindfulBrowse - User Flow Design (Mindful Delay + Strip)

## The Restriction Spectrum

```
Light <----------------------------------------------------> Heavy

  Strip              Friction              Block
  -----              --------              -----
  Mindful delay      Longer delay          Redirect to timer
  + hide elements    + intention check     (Pomodoro)

  "Break my impulse  "Make me really       "Don't let me
   and hide the       think before          in at all"
   distractions"      I go there"
```

---

## Flow 1: Mindful Delay + Strip (Default)

```
User clicks YouTube link
         |
         v
  Background intercepts navigation
         |
         v
  Check: Is site in blocklist and active?
         |
         v
  Redirect to interstitial page:

  +----------------------------------+
  |                                  |
  |  [Breathing animation]           |
  |                                  |
  |  Take a deep breath...           |
  |                                  |
  |  You're about to visit           |
  |  youtube.com                     |
  |                                  |
  |  [ 0 : 10 ]  (countdown)         |
  |                                  |
  |  [ I still want to go ]          |
  |                                  |
  +----------------------------------+
         |
         | After 10 seconds, button enables
         v
  User clicks "I still want to go"
         |
         v
  Redirect to youtube.com with stripping applied:
  - Sidebar hidden
  - Comments hidden
  - Shorts hidden
  - But video player works
```

**Why this works:**
- Delay breaks the dopamine loop (one sec: 57% reduction in opens)
- Stripping reduces doomscrolling if they proceed
- User retains agency (can still access the site)
- Two layers of protection: impulse + environment

---

## Flow 2: Friction (Longer Delay + Intention)

```
User clicks Twitter link (set to Friction level)
         |
         v
  Redirect to interstitial page:

  +----------------------------------+
  |                                  |
  |  [Breathing animation]           |
  |                                  |
  |  Take a deep breath...           |
  |                                  |
  |  You're about to visit           |
  |  twitter.com                     |
  |                                  |
  |  [ 0 : 30 ]  (longer countdown)  |
  |                                  |
  |  Why do you want to go there?    |
  |  [________________]              |
  |                                  |
  |  [ I still want to go ]          |
  |                                  |
  +----------------------------------+
         |
         | After 30 seconds + intention entered
         v
  User clicks "I still want to go"
         |
         v
  Redirect to twitter.com with stripping applied
```

**Why this works:**
- Longer delay for high-risk sites
- Intention prompt adds cognitive friction
- Writing forces conscious decision

---

## Flow 3: Block (Hard Redirect)

```
User clicks Reddit link (set to Block level)
         |
         v
  Immediate redirect to Pomodoro timer page:

  +----------------------------------+
  |                                  |
  |  You were heading to             |
  |  reddit.com - stay focused!      |
  |                                  |
  |  [ 25 : 00 ]  (timer)            |
  |  WORK  Session 1 of 4            |
  |                                  |
  |  [Start] [Pause] [Skip] [Reset]  |
  |                                  |
  +----------------------------------+
```

**Why this works:**
- No negotiation for sites user wants fully blocked
- Timer provides structured alternative
- Clear boundary

---

## Flow 4: Lock Down (Session Escalation)

```
User opens MindfulBrowse popup
         |
         v
  +----------------------------------+
  |  Lock Down                       |
  |                                  |
  |  [ 25 min v ]  [ START ]         |
  +----------------------------------+
         |
         | User clicks START
         v
  Timer starts (25:00 countdown)
  Storage sets: focusSessionActive = true
         |
         v
  User tries to visit ANY blocklist site
         |
         v
  Background sees focusSessionActive = true
  Overrides all restriction levels -> Block mode
         |
         v
  Redirect to Timer page
         |
         | ... timer counts down ...
         |
         v
  Timer reaches 0:00
  Storage sets: focusSessionActive = false
  Sites revert to their base restriction levels
```

**Why this works:**
- Temporary escalation for deep work sessions
- No permanent changes to site settings
- Clear start/end boundaries

---

## Flow 5: Popup UI - Blocklist Tab

```
+------------------------------------------+
|  MindfulBrowse              [Master Toggle] |
|     Stay focused, stay sharp             |
+------------------------------------------+
|  [ Blocklist ]  [ Timer ]                |
--------------------------------------------
|                                          |
|  +------------------------------------+ |
|  |  Lock Down                         | |
|  |                                    | |
|  |  [ 25 min v ]    [ START ]         | |
|  |                                    | |
|  |  Session active: 18:42 remaining   | |
|  |  [ STOP ]                          | |
|  +------------------------------------+ |
|                                          |
|  BLOCKED SITES                    (2)    |
|                                          |
|  +------------------------------------+ |
|  | >  [Strip v]  (toggle on/off)      | |
|  |    [x] Sidebar  [x] Comments       | |
|  |    [x] Shorts   [x] End Screen     | |
|  +------------------------------------+ |
|                                          |
|  +------------------------------------+ |
|  | f  [Friction v]  (toggle on/off)   | |
|  |    Delay: 30 seconds               | |
|  +------------------------------------+ |
|                                          |
|  +------------------------------------+ |
|  | X  [Block v]  (toggle on/off)      | |
|  |    (no stripping options needed)   | |
|  +------------------------------------+ |
|                                          |
|  + Add website...                        |
|                                          |
|  Default: Mindful delay + strip.         |
|  Switch to Friction or Block for more.   |
+------------------------------------------+
```

---

## Flow 6: Popup UI - Timer Tab

```
+------------------------------------------+
|  MindfulBrowse              [Master Toggle] |
--------------------------------------------
|  [ Blocklist ]  [ Timer ]                |
--------------------------------------------
|                                          |
|        +-----------------+               |
|        |  2 5 : 0 0      |               |
|        |    WORK           |               |
|        |  Session 1 of 4  |               |
|        |  * o o o         |               |
|        +-----------------+               |
|                                          |
|  [ Start ] [ Pause ] [ Skip ] [ Reset ]  |
|                                          |
|  -------------------------------------   |
|  Timer Settings                          |
|                                          |
|  Work Duration      [25 min] --*--       |
|  Short Break        [ 5 min] -*--        |
|  Long Break         [15 min] ---*--      |
|  Rounds             [ 4    ] --*--       |
|                                          |
|  Open full-screen timer >                |
+------------------------------------------+
```

---

## Storage Schema

```javascript
chrome.storage.sync = {
  enabled: true,

  sites: [
    {
      domain: "youtube.com",
      active: true,
      restrictionLevel: "strip",       // "strip" | "friction" | "block"
      frictionDelay: 10,               // seconds (only for friction mode)
      strippingProfile: {              // which elements to hide
        sidebar: true,
        comments: true,
        shorts: true,
        homeFeed: true,
        trending: true,
        endScreen: true
      }
    },
    {
      domain: "twitter.com",
      active: true,
      restrictionLevel: "friction",
      frictionDelay: 30,
    }
  ],

  pomodoroSettings: {
    workDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    roundsBeforeLong: 4,
  },

  focusSessionActive: false,           // Lock Down flag
  focusSessionEndsAt: null,            // timestamp (for recovery)
  
  proLicense: null,                    // "honor" | "verified-xxx" | null
}

chrome.storage.local = {
  MindfulBrowse_timer_state: {
    phase: "work",
    currentRound: 1,
    totalRounds: 4,
    isRunning: true,
    endsAt: 1724342400000,
    savedAt: 1724340600000,
  }
}
```

---

## Migration from Current State

```
Current                          Proposed
-------                          --------

interventionMode:                restrictionLevel:
  "strip" | "block"                "strip" | "friction" | "block"

frictionLevel: 1, 2, 3           frictionDelay: N seconds
  (only in block mode)             (only in friction mode)

No mindful delay                 Mindful delay interstitial
                                   (10s default for strip mode)

Timer = separate feature         Timer = Block mode's engine
                                  + Lock Down escalation
```

---

## Competitive Positioning

| Feature | MindfulBrowse | one sec | Unhook |
|---------|-----------|---------|--------|
| Mindful delay | Yes (10s) | Yes (various) | No |
| DOM stripping | Yes | No | Yes (YouTube only) |
| Privacy (zero-network) | Yes | No (requires account) | Yes |
| Price | Free core, $3.99/mo Pro | $19.99/yr | Free |
| Platforms | YouTube, Facebook (more coming) | All apps | YouTube only |
| Per-site granularity | Yes | No (same delay for all) | Yes |

**Unique value proposition:**
"The privacy-first, free alternative to one sec with better DOM control."
