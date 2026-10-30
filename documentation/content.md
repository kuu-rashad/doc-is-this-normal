# Game content

All symptom and prescription templates currently in `assets/gameconfig.json`, for reading and editing.
Edit them here, then ask Claude to copy the changes back into the config (or edit the JSON directly).

Limits: a blank fill is at most 40 characters, a whole symptom 160, a whole prescription 120.

Each template has one blank, `{{}}`. Players can write whatever they like in it; **Surprise me** picks one of the options at random, and **Walk-in** is the fill used for that template's premade symptom.

## Symptom templates

### Mild: Everyday weirdness (tier 1)

#### mild_01

> Whenever I open my inbox, I get an uncontrollable urge to {{}}.

- Walk-in: "vomit"
- Surprise me options: "quit my job", "throw my laptop out of the window", "fake my own death", "become a goat farmer"

#### mild_02

> It started small. First I could only bend spoons. Now I can {{}}, and my neighbors are concerned.

- Walk-in: "bend other people's wills"
- Surprise me options: "bend lampposts with my mind", "fly to the grocery store", "summon pigeons at will", "control every printer in the building", "see through walls", "levitate the neighbor's car", "melt cutlery by staring at it", "hear what their houseplants think"

#### mild_03

> I've tried yoga, therapy and essential oils, but I still scream every time I see {{}}.

- Walk-in: "a cucumber"
- Surprise me options: "a pigeon", "a spreadsheet", "my landlord", "a man in a fedora", "the color beige", "a Gantt chart", "an unread Slack thread", "a clown on a unicycle"

#### mild_04

> My cat has started {{}}, and I think it's contagious, because yesterday I did it too.

- Walk-in: "licking its balls"
- Surprise me options: "barking at the mailman", "hiding my car keys", "licking the windows", "judging my outfits", "sleeping in the dishwasher", "eating socks", "knocking my coffee off the desk", "staring at the wall for hours"

#### mild_05

> Every time I get a Slack notification from {{}}, I pee a little before I've even read it.

- Walk-in: "my manager"
- Surprise me options: "my manager", "the CEO", "HR, who is on leave", "the intern", "IT support", "that one guy from Finance", "the client", "my team lead"

### Awkward: Office malfunctions (tier 2)

#### awkward_02

> My Slack status has been stuck on "{{}}" for weeks, and I've started to believe it.

- Walk-in: "Working hard"
- Surprise me options: "In a meeting", "Out sick", "On vacation 🏖️", "Do not disturb", "Focusing", "Living my best life", "Hiding from the client", "Probably napping"

#### awkward_03

> I physically can't stop calling my manager {{}}. It's been going on for three months.

- Walk-in: "Mom"
- Surprise me options: "Mom", "Dad", "Your Majesty", "Coach", "babe", "Captain", "Sensei", "Grandma"

#### awkward_04

> During my performance review I {{}}. Lucky for me our HR is on leave.

- Walk-in: "intentionally sharted"
- Surprise me options: "cried a little", "called my manager “Mom”", "fell asleep", "ate a whole rotisserie chicken", "asked for a hug", "negotiated in a pirate accent", "shared my screen with Tinder open", "burped the alphabet"

#### awkward_05

> I can only give client presentations while {{}}. They haven't noticed yet.

- Walk-in: "intoxicated"
- Surprise me options: "standing on one leg", "wearing a cape", "eating soup", "holding my cat", "lying on the floor", "sitting in a bathtub", "wearing no pants", "whispering"

### Gross: Bodies behaving badly (tier 3)

#### gross_01

> I can't use the bathroom unless I'm thinking about {{}}.

- Walk-in: "my performance review"
- Surprise me options: "tax returns", "the CEO", "Excel macros", "my high school gym teacher", "the company retreat", "lukewarm soup", "the client's feedback", "the quarterly roadmap"

#### gross_02

> I sweat uncontrollably whenever I'm near {{}}.

- Walk-in: "our CEO"
- Surprise me options: "the CEO", "the office fridge", "a printer", "my ex", "the client", "a Google Meet invite", "a whiteboard", "anyone from HR"

#### gross_05

> I've been saving my toenail clippings in a jar labeled "{{}}". Is that a hobby?

- Walk-in: "Sell if unemployed"
- Surprise me options: "Do not eat", "Grandma's jam", "Q3 results", "Emergency snacks", "Souvenirs", "Party mix", "Office treats", "Gifts for the client"

#### gross_06

> I keep finding {{}} somewhere it absolutely should not be, and I have no memory of how it got there.

- Walk-in: "my laptop"
- Surprise me options: "a TV remote", "a whole lasagna", "my manager's stapler", "a live hamster", "a traffic cone", "my passport", "a Christmas ornament", "a rubber chicken"

### Spicy: Flirting malfunctions (tier 4)

#### spicy_02

> Every time I try to look sexy, I end up looking like {{}}.

- Walk-in: "a croissant"
- Surprise me options: "a confused penguin doing yoga", "a startled giraffe", "a wet cat", "a malfunctioning robot", "a nervous flamingo on ice", "a deflating balloon", "my grandpa doing the worm", "a raccoon caught in headlights"

#### spicy_04

> I keep accidentally sending voice memos of me {{}} to my mom. It's happened four times this week.

- Walk-in: "moaning"
- Surprise me options: "singing in the shower", "practicing my Oscar speech", "flirting with my mirror", "rapping about cheese", "crying at a dog video", "rehearsing a breakup", "moaning at a pastry", "talking dirty to my plants"

#### spicy_05

> I get way too excited whenever I {{}}. I've already been banned from two IKEAs.

- Walk-in: "assemble a KALLAX"
- Surprise me options: "assemble furniture", "see a cucumber", "test-sit a sofa", "smell fresh bread", "eat Swedish meatballs", "peel a banana", "hear an Allen key drop", "browse the lighting section"

#### spicy_07

> I keep sending flirty Slack DMs to the client channel. The client keeps replying with {{}}.

- Walk-in: "a thumbs-up emoji"
- Surprise me options: "“Noted.”", "“Per my last email…”", "“Let's take this offline”", "“😳”", "“Love this energy”", "“Can you send the invoice?”", "“👍”", "“Approved!”"

### After hours: Questionable bedroom behavior (tier 5)

#### after_hours_02

> My partner and I tried {{}}, and now we both need a chiropractor.

- Walk-in: "moving our piano"
- Surprise me options: "the reverse pretzel", "the folding chair", "the IKEA manual", "the flying squirrel", "the starfish", "the plank", "the human pyramid", "the Rubik's cube"

#### after_hours_03

> I can only climax while thinking about {{}}.

- Walk-in: "SQL Queries"
- Surprise me options: "tax forms", "the quarterly roadmap", "my dentist", "cold soup", "Excel formulas", "my grandma's casserole", "a broken printer", "the HR handbook"

#### after_hours_04

> We role-played as {{}}, and now I can't go grocery shopping without getting aroused.

- Walk-in: "a pair of shopping carts"
- Surprise me options: "a cashier and a coupon", "a butcher and a sausage", "a shelf-stacker and a melon", "a security guard and a shoplifter", "a farmer and a cucumber", "two rival bakers", "a barcode scanner and a barcode", "a pirate and a parrot"

## Prescription templates

#### rx_01

> Sounds like you need {{}}.

- Surprise me options: "a strongly worded email", "two business days off", "an exorcism", "a nap under your desk", "a hug from HR", "more cowbell", "a decaf intervention", "less eye contact with the printer", "a sabbatical in Lapland", "a fax machine", "a goat", "emotional support pigeons", "a bigger monitor", "leeches", "a mute button for your whole life", "three espressos", "a sauna and a long silence", "a team-building retreat", "a Jira ticket", "a second opinion from the intern", "a vacation from your own brain", "a note excusing you from Mondays", "duct tape", "a priest", "a raise", "a new personality", "bubble wrap", "a rubber duck", "a weighted blanket and a lawyer", "a stern talking-to", "airplane mode", "ice cream for dinner", "an emotional support houseplant", "more sleep and fewer opinions", "a spreadsheet about your feelings"

#### rx_02

> {{}} should do it.

- Surprise me options: "a strongly worded email", "two business days off", "an exorcism", "a nap under your desk", "a hug from HR", "more cowbell", "a decaf intervention", "less eye contact with the printer", "a sabbatical in Lapland", "a fax machine", "a goat", "emotional support pigeons", "a bigger monitor", "leeches", "a mute button for your whole life", "three espressos", "a sauna and a long silence", "a team-building retreat", "a Jira ticket", "a second opinion from the intern", "a vacation from your own brain", "a note excusing you from Mondays", "duct tape", "a priest", "a raise", "a new personality", "bubble wrap", "a rubber duck", "a weighted blanket and a lawyer", "a stern talking-to", "airplane mode", "ice cream for dinner", "an emotional support houseplant", "more sleep and fewer opinions", "a spreadsheet about your feelings"

#### rx_03

> I'm afraid you'll have to {{}}.

- Surprise me options: "move to the woods", "delete Slack", "scream into a pillow", "apologize to the printer", "quit Google Meet forever", "eat a whole cucumber", "reply-all with an apology", "dance it out", "marry the office plant", "join a monastery", "switch to decaf", "hand in your badge", "adopt a goat", "sit in the sauna until it stops", "talk to a rubber duck", "change your name", "burn the spreadsheet", "mute everyone", "wear a helmet", "call your mother", "touch grass", "lie down on the floor for a while", "learn to whistle", "ignore it until it goes away", "sleep for a week", "blame the intern", "start a podcast about it", "fake your own death", "move back in with your parents", "take up knitting", "write a haiku about it", "book a one-way ticket to Lapland", "turn yourself off and on again", "unplug your router", "hide under your desk professionally"

#### rx_04

> The only thing I can prescribe for you is {{}}.

- Surprise me options: "a strongly worded email", "two business days off", "an exorcism", "a nap under your desk", "a hug from HR", "more cowbell", "a decaf intervention", "less eye contact with the printer", "a sabbatical in Lapland", "a fax machine", "a goat", "emotional support pigeons", "a bigger monitor", "leeches", "a mute button for your whole life", "three espressos", "a sauna and a long silence", "a team-building retreat", "a Jira ticket", "a second opinion from the intern", "a vacation from your own brain", "a note excusing you from Mondays", "duct tape", "a priest", "a raise", "a new personality", "bubble wrap", "a rubber duck", "a weighted blanket and a lawyer", "a stern talking-to", "airplane mode", "ice cream for dinner", "an emotional support houseplant", "more sleep and fewer opinions", "a spreadsheet about your feelings"

#### rx_06

> Go home, {{}}, and stop googling your symptoms.

- Surprise me options: "move to the woods", "delete Slack", "scream into a pillow", "apologize to the printer", "quit Google Meet forever", "eat a whole cucumber", "reply-all with an apology", "dance it out", "marry the office plant", "join a monastery", "switch to decaf", "hand in your badge", "adopt a goat", "sit in the sauna until it stops", "talk to a rubber duck", "change your name", "burn the spreadsheet", "mute everyone", "wear a helmet", "call your mother", "touch grass", "lie down on the floor for a while", "learn to whistle", "ignore it until it goes away", "sleep for a week", "blame the intern", "start a podcast about it", "fake your own death", "move back in with your parents", "take up knitting", "write a haiku about it", "book a one-way ticket to Lapland", "turn yourself off and on again", "unplug your router", "hide under your desk professionally"

#### rx_07

> Take {{}} and call me in the morning.

- Surprise me options: "my hand", "care", "your hand off my leg", "a long hard look at yourself", "your pants off", "the stairs", "a hint", "it slow", "one for the team", "my number", "a cold shower", "a deep breath and your clothes off", "two of these", "the rest of the year off"

#### rx_08

> Before we continue, I'll need you to take off {{}}.

- Surprise me options: "your pants", "that attitude", "your wedding ring", "my glasses", "work tomorrow", "your tinfoil hat", "the cone of shame", "that ridiculous lanyard", "your LinkedIn profile", "the training wheels", "your socks, slowly"

#### rx_09

> Rub {{}} on it twice a day.

- Surprise me options: "some butter", "your ex's tears", "my business card", "a little prayer", "the client's feedback", "a rotisserie chicken", "the intern", "both hands", "whatever's in the office fridge", "your quarterly bonus", "a warm spoon"

#### rx_10

> Open wide and say {{}}.

- Surprise me options: "ahh", "my name", "sorry", "the safe word", "yes to the promotion", "goodbye to your dignity", "something nice about the client", "that again, slower", "“per my last email”", "what you said at the Christmas party"

#### rx_11

> Have you tried turning {{}} off and on again?

- Surprise me options: "yourself", "your marriage", "your manager", "the sauna", "your conscience", "me", "the CEO", "your personality", "the whole company", "your partner"

#### rx_12

> I'll need to examine your {{}} more closely.

- Surprise me options: "browser history", "search history", "love life", "left buttock", "tax return", "DMs", "tongue", "Spotify Wrapped", "sock drawer", "group chats", "life choices"

#### rx_13

> Swallow {{}} and don't tell HR.

- Surprise me options: "your pride", "this pill", "the evidence", "your words", "the key", "two of these", "a whistle", "the whole thing", "your feelings", "the USB stick"

#### rx_14

> I'm prescribing {{}}, to be taken rectally.

- Surprise me options: "a strongly worded email", "two business days off", "an exorcism", "a nap under your desk", "a hug from HR", "more cowbell", "a decaf intervention", "less eye contact with the printer", "a sabbatical in Lapland", "a fax machine", "a goat", "emotional support pigeons", "a bigger monitor", "leeches", "a mute button for your whole life", "three espressos", "a sauna and a long silence", "a team-building retreat", "a Jira ticket", "a second opinion from the intern", "a vacation from your own brain", "a note excusing you from Mondays", "duct tape", "a priest", "a raise", "a new personality", "bubble wrap", "a rubber duck", "a weighted blanket and a lawyer", "a stern talking-to", "airplane mode", "ice cream for dinner", "an emotional support houseplant", "more sleep and fewer opinions", "a spreadsheet about your feelings"
