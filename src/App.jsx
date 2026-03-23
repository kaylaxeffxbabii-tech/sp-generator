import { useState, useRef, useEffect, useCallback } from "react";

// Auto-detect environment:
// claude.ai artifact → direct API (key injected by Claude)
// localhost → Vite proxy (key from .env)
// Netlify deploy → Netlify function at same path (key from Netlify env vars)
const isClaudeAI = window.location.hostname.includes("claude") || window.location.hostname.includes("claudeusercontent");
const API_URL = isClaudeAI
  ? "https://api.anthropic.com/v1/messages"
  : "/.netlify/functions/anthropic";

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — KEYWORD ROUTER (score-based, not first-match)
// ═══════════════════════════════════════════════════════════════════════════════
const KEYWORD_MAP = {
  pool:     ["pool","swim","splash","float","aqua","waterpark","inflatable","hot tub","jacuzzi"],
  festival: ["festival","coachella","concert","music festival","camping","tent","outdoor rave","edm","music stage","mosh pit"],
  night:    ["nightclub","midnight club","neon bar","underground club","after hours","late night club","strip club","dive bar","speakeasy"],
  nature:   ["forest","woods","mountain","waterfall","cliff","desert","jungle","nature trail","creek","meadow","hiking"],
  trailer:  ["trailer park","mobile home","camper","rv park","country fair","backyard party","suburb"],
  gothic:   ["gothic","cathedral","cemetery","graveyard","vampire","witch","occult","haunted","crypt","dark ritual"],
  beach:    ["beach","ocean","surf","shore","sand","island","tropical","coastal","jetty","seaside"],
  party:    ["gala","cocktail party","dance party","birthday party","soiree","rooftop party","penthouse","wedding reception"],
};

function scoreKeywords(desc) {
  const lower = desc.toLowerCase();
  const scores = {};
  for (const [cat, words] of Object.entries(KEYWORD_MAP)) {
    scores[cat] = words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — SAFE JSON EXTRACTOR
// ═══════════════════════════════════════════════════════════════════════════════
function extractJSON(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function isValidWorldProfile(obj) {
  if (!obj) return false;
  // ensure arrays exist, fill with empty if missing
  obj.surfaces = Array.isArray(obj.surfaces) ? obj.surfaces : [];
  obj.structures = Array.isArray(obj.structures) ? obj.structures : [];
  obj.props = Array.isArray(obj.props) ? obj.props : [];
  obj.lightingSources = Array.isArray(obj.lightingSources) ? obj.lightingSources : [];
  obj.textures = Array.isArray(obj.textures) ? obj.textures : [];
  obj.palette = Array.isArray(obj.palette) ? obj.palette : [];
  obj.atmosphere = obj.atmosphere || "";
  // valid if we have at least a name and some content
  return typeof obj.worldName === "string" && (
    obj.surfaces.length > 0 || obj.props.length > 0 || obj.structures.length > 0
  );
}

function isValidSceneSlots(obj) {
  if (!obj) return false;
  const slots = ["tender","chaotic","editorial","candid","unexpected"];
  const valid = slots.filter(k => obj[k] && typeof obj[k].title === "string" && typeof obj[k].description === "string");
  return valid.length >= 3; // accept partial response — at least 3 of 5 slots
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — FALLBACK WORLD PROFILES (keyed by category)
// ═══════════════════════════════════════════════════════════════════════════════
const WORLD_PROFILES = {
  trailer: {
    worldName: "Trailer Park", atmosphere: "chaotic, sun-bleached, irreverent, scrappy-glamorous",
    surfaces: ["cracked gravel","corrugated metal siding","warped wood porch steps","rusted car hood","plastic lawn chair slats"],
    structures: ["trailer row","broken screen door","clothesline rigged between posts","above-ground pool","rusted chain-link fence"],
    props: ["cracked pink kiddy pool","sweating beer cooler","disposable grill with smoke","plastic lawn chairs","crushed aluminum cans","string lights on clothesline","flat tire in the yard"],
    lightingSources: ["harsh midday sun casting hard shadows","string lights at dusk","grill smoke diffusing golden light","single porch bulb"],
    textures: ["sun-bleached plastic","rust flake","wet gravel","warm beer label sweat","melting asphalt"],
    palette: ["hot pink","acid yellow","rust orange","faded turquoise","chrome silver"],
  },
  gothic: {
    worldName: "Gothic Cathedral Rave", atmosphere: "sacred, hedonistic, nocturnal, reverent chaos",
    surfaces: ["cold stone floor","worn cathedral pews","wax-dripped altar steps","iron candle stands","crumbling stone column"],
    structures: ["vaulted arches","stained glass windows","altar platform","side chapels","organ loft","iron gate"],
    props: ["votive candles in iron holders","incense smoke","velvet ropes","DJ booth built into the altar","fog machine","rose petals on stone","overturned chalice"],
    lightingSources: ["colored stained-glass spill","candlelight from 100 votives","strobes cutting through incense","low stage uplighting","single beam through a broken window"],
    textures: ["dust in colored light beams","aged stone","melted wax pooled on steps","smoke haze","cold iron"],
    palette: ["deep garnet","black plum","aged gold","cathedral blue","bone white"],
  },
  pool: {
    worldName: "Pool Party", atmosphere: "chaotic, sun-soaked, carefree, maximalist fun",
    surfaces: ["above-ground pool ledge","wet concrete pool deck","inflatable float surface","slip-n-slide tarp","damp towel on chair"],
    structures: ["above-ground pool","lawn umbrella","inflatable arch","garden fence","cooler station"],
    props: ["flamingo pool float","pink kiddy pool","garden hose","water balloons","sweating cooler","sunscreen bottle","cheap sunglasses","inflatable crown"],
    lightingSources: ["direct overhead sun","light refracting off water surface","ring of citronella torches","tiki lights at dusk"],
    textures: ["wet plastic","sunscreen on skin","water-logged fabric","damp concrete","slippery tarp"],
    palette: ["hot coral","electric aqua","flamingo pink","sun-bleached white","neon yellow"],
  },
  festival: {
    worldName: "Music Festival", atmosphere: "euphoric, dusty, communal, sensory-overloaded",
    surfaces: ["packed dirt ground","wooden festival stage","chain-link fence barrier","hay bale seating","merch tent floor"],
    structures: ["main stage rigging","ferris wheel","camping tent city","speaker tower","merch tent"],
    props: ["festival wristband stack","flag on a pole","emergency foil blanket","instant coffee cup","inflatable totem","glow stick crown","flower crown"],
    lightingSources: ["stage wash from below","golden hour backlighting","LED screen color spill","bonfire glow at night","sunrise through tent flap"],
    textures: ["festival dust","sequin catching light","damp sleeping bag","dew on canvas tent","matted grass"],
    palette: ["golden dust","stage purple","flag red","neon green","sunset amber"],
  },
  night: {
    worldName: "Night Out", atmosphere: "electric, spontaneous, 3am-energy, urban after-dark",
    surfaces: ["sticky bar rail","wet sidewalk","fire escape metal grating","taxi hood","parking garage concrete"],
    structures: ["neon-lit alley","rooftop railing","bodega entrance","club bathroom","fire escape"],
    props: ["buzzing neon sign","bodega cooler glass door","bathroom mirror","last-call drinks","cigarette smoke","taxi cab","parking garage barrier"],
    lightingSources: ["single sodium streetlight","neon sign bleed","bodega cooler interior light","club light spill through door","headlights on wet asphalt"],
    textures: ["wet pavement reflection","grease on mirror","cold glass cooler door","cigarette smoke","bass vibration in air"],
    palette: ["neon magenta","sodium orange","electric blue","3am grey","fluorescent white"],
  },
  nature: {
    worldName: "Wilderness", atmosphere: "raw, elemental, humbling, alive",
    surfaces: ["moss-covered rock face","wet creek stones","sandstone cliff edge","meadow grass","forest floor fern carpet"],
    structures: ["fallen log bridge","waterfall","cliff overhang","massive tree root cave","open meadow"],
    props: ["campfire","waterfall cascade","exposed tree roots","wildflowers","canyon view","storm clouds building"],
    lightingSources: ["golden hour backlight through tree canopy","waterfall mist diffusing sunlight","campfire below faces","lightning on the horizon","dawn light through fog"],
    textures: ["wet stone","bark texture","fern softness","campfire smoke","cold waterfall mist"],
    palette: ["forest green","golden ochre","storm grey","earth brown","wildflower violet"],
  },
  beach: {
    worldName: "Beach", atmosphere: "open, windswept, raw nature, time-suspended",
    surfaces: ["wet sand at shoreline","barnacle-crusted jetty wood","lifeguard stand platform","driftwood surface","saltwater-soaked clothing"],
    structures: ["wooden jetty","lifeguard stand","beach bonfire pit","tidal pool formation","dune ridge"],
    props: ["driftwood bonfire","inflatable raft","lifeguard stand","wave impact","tidal pool","sunbleached rope"],
    lightingSources: ["burning horizon sunset","bonfire on wet sand","overcast flat diffusion","wave-refracted sparkle","silhouette backlight"],
    textures: ["wet sand","salt-dried skin","barnacle rough","driftwood grain","cold ocean foam"],
    palette: ["sunset coral","ocean slate","bone sand","kelp green","salt-haze white"],
  },
  party: {
    worldName: "Party", atmosphere: "euphoric, social, peak-night energy, anything-goes",
    surfaces: ["leather club booth","club bathroom tile","glossy dancefloor","rooftop concrete","bar rail"],
    structures: ["disco ball rig","booth banquette","rooftop railing","DJ booth","neon wall sign"],
    props: ["spinning disco ball","neon bar sign","last-call drinks","bathroom mirror","DJ booth"],
    lightingSources: ["disco ball scatter","neon sign bleed","strobe","booth candlelight","city skyline from rooftop"],
    textures: ["sticky dancefloor","leather booth","neon on skin","3am smudged mirror","city light reflection"],
    palette: ["deep violet","gold","electric pink","midnight black","mirror silver"],
  },
};

function getFallbackWorldProfile(eventDesc) {
  const scores = scoreKeywords(eventDesc);
  // only use keyword library if something actually matched
  const topScore = scores[0]?.[1] || 0;
  if (topScore >= 2) {
    const best = scores[0][0];
    const profile = { ...WORLD_PROFILES[best] };
    profile.worldName = eventDesc;
    return profile;
  }
  // no keyword match — build a minimal generic world from the event name
  // the API will have already failed at this point, so give Gemini something
  // grounded in the event name itself rather than forcing a random category
  return {
    worldName: eventDesc,
    atmosphere: "immersive, specific, visually rich",
    surfaces: ["event floor surface","main stage or focal platform","entry corridor","crowd barrier","backstage area"],
    structures: ["main focal structure","surrounding architecture","lighting rig","signage","crowd arrangement"],
    props: ["event-specific props","thematic decorations","lighting elements","crowd items","featured objects"],
    lightingSources: ["main event lighting","atmospheric accent lights","practical sources","ambient fill","featured spotlights"],
    textures: ["surface textures of the space","material qualities","atmospheric particles","fabric and finish details","worn or aged surfaces"],
    palette: ["colors specific to this event's aesthetic","dominant hues","accent tones","light color temperature","shadow tones"],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — FALLBACK SCENE SLOTS (5 fixed moods per category)
// ═══════════════════════════════════════════════════════════════════════════════
const SCENE_SLOTS = {
  trailer: {
    tender:     { title: "Clothesline Slow Dance", description: "Slow dancing in the narrow gap between two trailers, actual laundry and string lights hanging overhead. Gravel underfoot. Porch bulb the only warm light. Bodies close, arms around each other.", pose: "slow embrace, cheek to cheek, feet barely moving", props: ["string lights","clothesline laundry","gravel","porch bulb"] },
    chaotic:    { title: "Kiddy Pool Chaos", description: "Both figures crammed into a cracked pink kiddy pool sitting on gravel, cans raised in a soaking mid-toast. Water sloshing over the deflated rim, lawn chair knocked sideways, cooler open behind them.", pose: "mid-toast, soaked, one arm out for balance", props: ["pink kiddy pool","gravel","aluminum cans","cooler"] },
    editorial:  { title: "Rusted Hood Throne", description: "Both seated on the dented hood of a sun-faded rusted car, feet braced on the bumper, cans dangling from two fingers each. Broken screen door hangs open behind them. Surveying the park like they own it.", pose: "seated back on hands, legs out, chin up", props: ["rusted car hood","bumper","screen door","gravel yard"] },
    candid:     { title: "Grill Smoke Break", description: "Caught leaning into each other beside a smoking disposable grill, one passing something, one foot up on the cooler. Hard midday shadows on the corrugated siding behind them. Mid-conversation.", pose: "leaning together, one foot propped, mid-pass", props: ["disposable grill","smoke","cooler","metal siding"] },
    unexpected: { title: "Trailer Roof at Sunset", description: "Perched on the actual roof of the trailer, legs dangling over the edge, the whole park below them at golden hour. Grill smoke curling from below. Both looking out at the horizon, not at each other.", pose: "seated at roof edge, legs dangling, looking out", props: ["trailer roof","corrugated metal","grill smoke","sunset sky"] },
  },
  gothic: {
    tender:     { title: "Pew Sprawl at Dawn", description: "Collapsed across a cathedral pew after the rave — one figure flat on their back, the other draped over them. Candles burning low nearby. Stained glass going pale with morning light.", pose: "draped and collapsed, one over the other, candlelight on faces", props: ["cathedral pew","low candles","stained glass dawn light"] },
    chaotic:    { title: "Altar Strobe Surrender", description: "Both figures pressed against the front of the DJ booth built into the cathedral altar, hands raised, faces tilted back. Strobes cutting through incense smoke. Fog machine pouring over the altar steps.", pose: "arms raised, faces back, hands pressed to altar face", props: ["altar DJ booth","strobes","incense smoke","fog machine"] },
    editorial:  { title: "Stained Glass Kneel", description: "Both kneeling on cold stone floor directly in a beam of stained glass color. One hand each pressed to the stone, heads bowed slightly. Dust particles suspended in the colored light beam.", pose: "kneeling facing each other, one hand pressed to floor", props: ["stained glass beam","cold stone floor","dust in light"] },
    candid:     { title: "Iron Gate Hold", description: "Both figures gripping the rusted iron bars of a cemetery gate from the inside. Faces pressed between the bars looking out. Mist low on the ground behind them. Mid-conversation, caught.", pose: "hands on bars, faces between them, bodies close", props: ["iron gate bars","mist","cemetery ground"] },
    unexpected: { title: "Sarcophagus Drape", description: "Both draped across a stone tomb in an overgrown crypt garden — one lying full-length on the lid, one seated at the head. Ivy on the walls, roses scattered across the stone lid.", pose: "one lying flat, one seated at head, draped and composed", props: ["stone tomb lid","ivy walls","scattered roses"] },
  },
  pool: {
    tender:     { title: "Floatie Drift", description: "Shot from above — both floating face-up on separate inflatable rafts, arms trailing in the water, eyes closed, just out of reach of each other. Drinks balanced on stomachs.", pose: "face-up, arms trailing, surrendered float", props: ["inflatable rafts","pool water","drinks balanced"] },
    chaotic:    { title: "Garden Hose Ambush", description: "One figure wielding a garden hose at full blast, the other caught mid-scream on the slip-n-slide, arms windmilling. Water freezing mid-arc in the frame. Pure impact moment.", pose: "one aiming hose, one mid-fall arms out", props: ["garden hose","slip-n-slide tarp","water arc"] },
    editorial:  { title: "Pool Ledge Power", description: "Both seated on the above-ground pool ledge, legs in the water, dripping. Staring dead into camera. Sun behind them, water surface catching light below.", pose: "seated on ledge, legs in water, direct eye contact with camera", props: ["pool ledge","water surface","backlit sun"] },
    candid:     { title: "Flamingo Confessional", description: "One figure draped belly-down over a flamingo pool float, whispering to the other who is gripping the pool ledge, half in the water, holding a sweating can. Caught mid-secret.", pose: "one over float, one gripping ledge half-submerged", props: ["flamingo float","pool ledge","sweating can"] },
    unexpected: { title: "Kiddy Pool Throne", description: "Both crammed into a cracked pink kiddy pool sitting directly on concrete or gravel. No pretense. Sunglasses on. One can raised. Looking at camera like this is completely normal.", pose: "knees up, crammed in, deadpan stare at camera", props: ["pink kiddy pool","concrete","aluminum cans","sunglasses"] },
  },
  festival: {
    tender:     { title: "Foil Blanket Sunrise", description: "Wrapped together in a shared emergency foil blanket outside their tent at sunrise. Instant coffee cups in hand. Festival wristbands stacked up both arms. Watching the field wake up.", pose: "side by side under blanket, cups in hand, looking out", props: ["foil blanket","tent","instant coffee","festival wristbands"] },
    chaotic:    { title: "Speaker Stack Climb", description: "One figure halfway up a festival speaker stack, arm stretched down to pull the other up. Both laughing, stage wash hitting them from the side. Crowd a blur below.", pose: "one climbing, one reaching up, both in motion", props: ["speaker stack","stage wash","crowd blur"] },
    editorial:  { title: "Ferris Wheel Peak", description: "Inside a stopped gondola at the apex — both leaning out opposite sides, arms wide. The entire festival grid spread below at golden hour. Wind in hair.", pose: "leaning out opposite sides, arms wide, wind motion", props: ["gondola bars","festival grid below","golden hour sky"] },
    candid:     { title: "Merch Tent Chaos", description: "Both buried in an overflowing merch tent, one holding up an oversized festival tee against the other, mid-laugh. Tote bags and lanyards everywhere. Overhead fluorescent light.", pose: "one holding shirt up against other, both mid-laugh", props: ["merch tent","festival tee","tote bags","fluorescent overhead"] },
    unexpected: { title: "Misting Fan Standoff", description: "Both standing directly in the spray of a giant industrial misting fan. Clothes and hair soaked flat. Eyes squinted into the blast. Grinning. Festival heat visible everywhere else.", pose: "facing fan, eyes squinted, hair and clothes blown back", props: ["industrial misting fan","spray","soaked fabric"] },
  },
  night: {
    tender:     { title: "Bar Rail Closing Time", description: "Both elbows on the sticky bar rail at last call. Faces close. That 3am soft-focus warmth of people who survived the whole night together. Bartender blurred behind.", pose: "elbows on bar, faces close, leaning in", props: ["bar rail","last-call drinks","blurred bartender"] },
    chaotic:    { title: "Taxi Hood Aftermath", description: "Both draped across the hood of a stopped yellow cab at 4am. Legs dangling, laughing at something from two hours ago. Driver watching in the rearview. Streetlight overhead.", pose: "draped back on cab hood, legs dangling, mid-laugh", props: ["taxi cab hood","streetlight","rearview mirror"] },
    editorial:  { title: "Neon Sign Lean", description: "Both leaning against a buzzing neon bar sign on the exterior wall. Color bleeding onto their skin. Arms crossed. Completely unbothered by everything behind them.", pose: "back to wall under neon, arms crossed, looking past camera", props: ["buzzing neon sign","exterior wall","neon color on skin"] },
    candid:     { title: "Bodega Cooler Door", description: "Caught outside a 24hr bodega at 2am. One holding the glass cooler door open, cold fog spilling onto the pavement. The other picking something from the lit shelves. Unbothered.", pose: "one holding door, one reaching in, cold fog on pavement", props: ["bodega glass cooler","cold fog","lit shelves","pavement"] },
    unexpected: { title: "Parking Garage Edge", description: "On the top deck of an empty parking garage. Both sitting on the concrete barrier edge, legs over the city. Two cheap cups. Skyline behind them. Nothing else.", pose: "seated on barrier edge, legs over the drop, cups in hand", props: ["concrete barrier","parking garage top","city skyline"] },
  },
  nature: {
    tender:     { title: "Root Cave Hideout", description: "Discovered under the exposed root system of a massive fallen tree. Both crouched in the cave formed by roots and earth. Faces lit by a phone or candle. Hidden.", pose: "crouched in root cave, faces close and lit from below", props: ["exposed tree roots","earth cave","single low light source"] },
    chaotic:    { title: "Log Bridge Standoff", description: "Both balanced on a moss-slicked fallen log over a creek. Arms out. One laughing too hard to keep balance. Water rushing below. Pure action frame.", pose: "arms out for balance, one tipping, one laughing", props: ["fallen log","creek water below","moss surface"] },
    editorial:  { title: "Cliff Edge Dangle", description: "Seated at the absolute edge of a sandstone cliff, legs dangling over nothing. Looking out at a canyon or valley together. One arm behind on the rock. Horizon dominant.", pose: "seated at cliff edge, legs over, one arm back on rock", props: ["sandstone cliff edge","canyon view","horizon sky"] },
    candid:     { title: "Waterfall Submersion", description: "Both standing chest-deep at the base of a waterfall. Faces tilted up directly into the cascade. White water crashing around them. Nothing else visible.", pose: "faces up into cascade, chest-deep, arms out", props: ["waterfall cascade","white water crash","mist"] },
    unexpected: { title: "Field Fire", description: "Standing either side of a small campfire in an open meadow. Sky going full purple-black behind them. Smoke rising straight up in still air. Faces orange-lit from below. Vast emptiness around them.", pose: "standing either side of fire, faces lit from below, sky behind", props: ["campfire","open meadow","purple sky","rising smoke"] },
  },
  beach: {
    tender:     { title: "Bonfire Sand Side", description: "Both crouched close to a driftwood beach bonfire. Faces warm and lit from below. Ocean completely black behind them. Sound of waves implied in the frame.", pose: "crouched close, faces lit from fire below, leaning in", props: ["driftwood bonfire","wet sand","black ocean behind"] },
    chaotic:    { title: "Wave Impact", description: "Caught at the exact moment a breaking wave detonates around them at chest height. Arms thrown up. Faces mid-scream-laugh. Saltwater frozen in every direction.", pose: "arms up, faces mid-laugh-scream, wave impact all around", props: ["breaking wave","saltwater explosion","shore line"] },
    editorial:  { title: "Lifeguard Stand Takeover", description: "Both occupying a lifeguard stand at off-hours. One in the chair doing the bit. The other on the ladder step below looking up. Deserted beach stretching behind in both directions.", pose: "one seated high in chair, one on ladder below looking up", props: ["lifeguard stand","ladder","deserted beach"] },
    candid:     { title: "Jetty End", description: "Sitting at the end of a barnacle-crusted wooden jetty. Legs dangling over open water. Backs to shore. No land visible ahead. Mid-conversation caught.", pose: "seated side by side, legs over edge, mid-conversation", props: ["jetty end","barnacle wood","open ocean ahead"] },
    unexpected: { title: "Tidal Pool Map", description: "Both lying on their stomachs on flat rock, peering down into a tidal pool together. Faces close to the water. Everything in the tidal pool visible. Bodies horizontal on the rock.", pose: "lying stomach-down on rock, faces over tidal pool", props: ["tidal pool","flat coastal rock","rock reflection"] },
  },
  party: {
    tender:     { title: "Booth Lean Closing Time", description: "Collapsed into a leather club booth, legs overlapping, empty glasses on the table. One leaning over the other to say something into their ear. Bass implied.", pose: "collapsed together, one leaning to whisper, legs overlapping", props: ["leather booth","empty glasses","table"] },
    chaotic:    { title: "Disco Ball Orbit", description: "Directly below a spinning mirror disco ball. Faces fractured in reflected light. One mid-spin, arm extended. The other catching them by the wrist. Full motion frame.", pose: "one mid-spin, arm out, other catching wrist", props: ["disco ball above","reflected light scatter","dancefloor"] },
    editorial:  { title: "Neon Exterior Lean", description: "Leaning against a buzzing neon sign on the venue exterior. Color bleeding onto both their skin. Arms crossed, chin up. Completely composed against the chaos behind them.", pose: "back to wall, arms crossed, neon color cast on faces", props: ["neon sign","exterior wall","color bleed on skin"] },
    candid:     { title: "Bathroom Counter Caught", description: "Both perched on a club bathroom counter, legs dangling, touching up in the smudged mirror. One making a face at the other in the reflection. Mid-laugh. Lipstick out.", pose: "seated on counter, mid-touch-up, caught in mirror laughing", props: ["bathroom counter","smudged mirror","lipstick","club lighting"] },
    unexpected: { title: "Rooftop Barrier Sit", description: "Both sitting on a rooftop concrete barrier at the party's edge. Backs to the room, faces to the city. Two drinks. Just the skyline.", pose: "sitting on barrier, backs to room, faces to city, drinks in hand", props: ["rooftop barrier","city skyline","drinks","party noise behind"] },
  },
};

function getFallbackScenes(eventDesc, subjectCount) {
  const scores = scoreKeywords(eventDesc);
  const topScore = scores[0]?.[1] || 0;
  if (topScore >= 2) {
    return scaleScenesForCount(SCENE_SLOTS[scores[0][0]], eventDesc, subjectCount || 2);
  }
  // no keyword match — return generic scenes scaled to subject count
  return buildGenericScenes(eventDesc, subjectCount || 2);
}

function scaleScenesForCount(slots, eventDesc, count) {
  if (count <= 2) return slots;
  // rewrite all slot descriptions to mention all figures
  const result = {};
  for (const [key, slot] of Object.entries(slots)) {
    result[key] = {
      ...slot,
      description: slot.description
        .replace(/Both figures/g, `All ${count} figures`)
        .replace(/Two figures/g, `${count} figures`)
        .replace(/one figure pulling the other/g, `figures pulling each other`)
        .replace(/both mid-laugh/g, `all mid-laugh`)
        .replace(/one figure/g, `one figure`)
        + (count >= 3 ? ` A third figure is physically integrated into the scene at a distinct spatial position — not background, fully present.` : ""),
      pose: slot.pose + (count >= 3 ? `, third figure mirrors or contrasts the group energy at their own position` : ""),
    };
  }
  return result;
}

function buildGenericScenes(e, count) {
  const fig = count === 1 ? "One figure" : count === 2 ? "Two figures" : `${count} figures`;
  const all = count === 1 ? "The figure" : count === 2 ? "Both figures" : `All ${count} figures`;
  const third = count >= 3 ? ` A third figure occupies the far edge of the frame, physically connected to a scene prop, facing inward toward the group.` : "";
  const spatial = count >= 3 ? ` Each figure holds a distinct spatial zone — left foreground, center midground, right foreground.` : "";
  return {
    tender:     { title: "Quiet Corner", description: `${fig} tucked into a quieter edge of the ${e} space, backs to the main event, faces close in private conversation. The energy of the event hums behind them.${third}`, pose: `leaning toward each other, heads close, backs to crowd${count >= 3 ? ", third figure pressed against a scene surface at the edge" : ""}`, props: ["event space edge","ambient event lighting"] },
    chaotic:    { title: "Peak Moment", description: `${all} caught at the height of the ${e} experience — arms up, faces turned toward the main focal point, fully absorbed in the chaos. Mid-reaction, unguarded.${spatial}`, pose: `arms raised, faces turned toward event focal point, mid-reaction${count >= 3 ? ", all three figures mid-action at their own spatial positions" : ""}`, props: ["event focal point","crowd energy","main lighting"] },
    editorial:  { title: "Threshold Pose", description: `${all} framed in the main entrance or threshold of the ${e} space. Composed, deliberate, aware of the camera.${spatial} The event world visible behind them.`, pose: `standing composed at threshold, facing camera${count >= 3 ? ", three figures in a triangular or linear arrangement" : ""}`, props: ["event entrance","event signage or decor","ambient lighting"] },
    candid:     { title: "Caught Between", description: `Caught mid-navigation through the ${e} space — figures pulling each other through a gap in the crowd, all mid-laugh, hands connected in a chain. Nobody looking at camera.${third}`, pose: `figures in a chain, pulling each other through the crowd, mid-laugh, in motion${count >= 3 ? ", third figure at the end of the chain, half-turning back" : ""}`, props: ["crowd gap","event floor","practical lighting"] },
    unexpected: { title: "Above It All", description: `${all} elevated above the main ${e} action — on a platform, step, or raised surface — looking down at everything below with ownership.${spatial} The whole event visible beneath them.`, pose: `standing on elevated surface, looking down at event below${count >= 3 ? ", figures spread across the platform at left, center, right positions" : ""}`, props: ["elevated platform or step","event floor below","overhead lighting"] },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — APPEARANCE NORMALIZER
// ═══════════════════════════════════════════════════════════════════════════════
function normalizeAppearance(raw) {
  if (!raw || !raw.trim()) return null;
  let s = raw;
  // strip ethnicity/biometric triggers
  s = s.replace(/\b(east asian|southeast asian|south asian|asian|chinese|japanese|korean|vietnamese|indian|middle eastern|arabic|persian|african american|african|latina|latino|hispanic|mexican|caucasian|white|european|black american|mixed race|biracial|multiracial)\b/gi, "");
  // skin tone — normalize to light/photo-safe descriptors
  s = s.replace(/\b(fair|light|pale)\s*(skin|complexion|tone)?\b/gi, "cool-ivory skin with translucent luminosity");
  s = s.replace(/\b(tan|tanned|olive)\s*(skin|complexion|tone)?\b/gi, "golden-olive complexion with warm undertone");
  s = s.replace(/\b(medium brown|brown)\s*(skin|complexion|tone)?\b/gi, "warm sienna complexion with amber undertone");
  s = s.replace(/\b(dark|deep brown|deep)\s*(skin|complexion|tone)?\b/gi, "deep mahogany complexion with cool-ebony depth");
  s = s.replace(/\bblack\s*(skin|complexion|tone)\b/gi, "deep blue-black complexion with iridescent depth");
  s = s.replace(/\bcool[- ]?toned\s*(skin|complexion)?\b/gi, "cool-luminous skin with blue undertone");
  s = s.replace(/\bwarm[- ]?toned\s*(skin|complexion)?\b/gi, "warm-luminous skin with amber undertone");
  // hair — specific shade descriptors
  s = s.replace(/\bblack hair\b/gi, "deep blue-black hair, lacquered high-sheen");
  s = s.replace(/\bdark brown hair\b/gi, "deep espresso-brown hair with warm dimension");
  s = s.replace(/\bbrown hair\b/gi, "warm chestnut hair with natural dimension");
  s = s.replace(/\bdark hair\b/gi, "dark espresso hair");
  s = s.replace(/\bred hair\b/gi, "deep garnet-auburn hair");
  s = s.replace(/\bblonde hair\b/gi, "honeyed blonde hair");
  s = s.replace(/\bwhite hair\b/gi, "silver-white hair");
  s = s.replace(/\bgray hair\b/gi, "silver-pewter hair");
  // eyes
  s = s.replace(/\bbrown eyes\b/gi, "deep amber-brown eyes");
  s = s.replace(/\bblue eyes\b/gi, "steel-blue eyes");
  s = s.replace(/\bgreen eyes\b/gi, "sage-green eyes");
  s = s.replace(/\bhazel eyes\b/gi, "amber-green hazel eyes");
  s = s.replace(/\bdark eyes\b/gi, "deep obsidian eyes");
  s = s.replace(/\balmond[- ]?shaped eyes\b/gi, "elongated almond-contoured eyes");
  // person references
  s = s.replace(/\b(woman|female|girl|lady|man|male|guy|person)\b/gi, "figure");
  s = s.replace(/\breal person\b/gi, "original character");
  // body shape
  s = s.replace(/\bhourglass\s*(figure|body|build)?\b/gi, "pronounced waist-to-hip silhouette");
  s = s.replace(/\bpetite\s*(figure|body|build)?\b/gi, "fine-boned compact frame");
  s = s.replace(/\b(curvy|plus.?size)\s*(figure|body|build)?\b/gi, "full sculptural figure");
  s = s.replace(/\b(slim|slender|skinny)\s*(figure|body|build)?\b/gi, "elongated willowy frame");
  s = s.replace(/\b(muscular|athletic)\s*(figure|body|build)?\b/gi, "powerfully built athletic frame");
  return s.replace(/\s{2,}/g, " ").trim();
}

function generateArchetype(name, appearance) {
  const alias = name?.trim() || null;
  const match = appearance?.match(/\b(garnet|auburn|espresso|ivory|platinum|chestnut|raven|obsidian|golden|silver|mahogany|sienna|amber|blue-black)\b/i);
  const tone = match?.[1]?.toLowerCase();
  const archetypes = {
    "garnet":"The Garnet Sovereign","auburn":"The Crimson Matriarch","espresso":"The Velvet Shadow",
    "ivory":"The Ivory Revenant","platinum":"The Silver Specter","chestnut":"The Amber Nomad",
    "raven":"The Raven Alchemist","obsidian":"The Obsidian Phantom","golden":"The Golden Wanderer",
    "silver":"The Silver Phantom","mahogany":"The Mahogany Muse","sienna":"The Sienna Spirit",
    "amber":"The Amber Oracle","blue-black":"The Midnight Sovereign",
  };
  const archetype = tone ? (archetypes[tone] || "The Unnamed Muse") : "The Unnamed Muse";
  return alias ? `${alias} (${archetype})` : archetype;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — WARDROBE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
// Items that exist below the waist — suppress when camera crops them out
const BELOW_WAIST_TERMS = [
  /(boots?|heels?|shoes?|sneakers?|sandals?|pumps?|stilettos?|platforms?|footwear|loafers?)/gi,
  /(trousers?|pants?|jeans?|shorts?|skirts?|leggings?|tights?|stockings?|thigh[- ]highs?)/gi,
  /(thigh|knee|ankle|calves?|legs?|feet|foot)/gi,
];
const BELOW_SHOULDER_TERMS = [
  ...BELOW_WAIST_TERMS,
  /(corset|bustier|bodysuit|crop[- ]top|bralette|bikini[- ]top|torso|waist|midriff|stomach|abs|chest|décolletage|neckline)/gi,
  /(sleeves?|arms?|hands?|wrists?|rings?|bracelets?|cuffs?|gloves?|nail[s]?)/gi,
];

function stripBelowCrop(text, cameraKey) {
  if (!text) return text;
  if (cameraKey === "waistUp") {
    let s = text;
    BELOW_WAIST_TERMS.forEach(r => { s = s.replace(r, "[not in frame]"); });
    return s.replace(/,?\s*\[not in frame\](\s*,\s*\[not in frame\])*/g, "").replace(/,\s*$/, "").trim();
  }
  if (cameraKey === "beautyClose") {
    let s = text;
    BELOW_SHOULDER_TERMS.forEach(r => { s = s.replace(r, "[not in frame]"); });
    return s.replace(/,?\s*\[not in frame\](\s*,\s*\[not in frame\])*/g, "").replace(/,\s*$/, "").trim();
  }
  return text;
}

function buildWardrobeBlock(subject, eventDesc, styleLabel, cameraKey) {
  if (subject.wardrobe?.trim()) {
    const stripped = stripBelowCrop(subject.wardrobe.trim(), cameraKey);
    if (cameraKey === "beautyClose") {
      return `[VISIBLE STYLING — face/neck/shoulders only, render exactly as specified]: ${stripped}. Render only what is visible above the shoulder line — face makeup, hair styling, neck/ear jewelry, skin texture.`;
    }
    if (cameraKey === "waistUp") {
      return `[OUTFIT — waist-up crop, render only visible elements]: ${stripped}. Do NOT render footwear, leg styling, or anything below the waist.`;
    }
    return `[OUTFIT — render exactly as specified, do not alter or omit]: ${subject.wardrobe.trim()}`;
  }
  if (cameraKey === "beautyClose") {
    return `[VISIBLE STYLING — face/neck/shoulders only]: Assign face and hair styling appropriate to ${eventDesc} in ${styleLabel} aesthetic. Must include: makeup direction (eye, lip, skin finish), hair styling (structure, texture, finish), neck and ear jewelry only. No body or outfit styling — only what appears above the shoulder line.`;
  }
  if (cameraKey === "waistUp") {
    return `[OUTFIT — waist-up only]: Assign upper-body styling appropriate to ${eventDesc} in ${styleLabel} aesthetic. Must include: top garment with fabric and silhouette, visible sleeve/arm styling, jewelry visible above waist, hair styling, makeup direction, nail styling. Do NOT assign footwear or lower-body garments.`;
  }
  return `[OUTFIT — mandatory, fully render]: Assign a complete look appropriate to ${eventDesc} in ${styleLabel} aesthetic. Must include: primary garment with fabric and silhouette, secondary layers, footwear style, accessories, jewelry, nail styling, hair styling, and makeup direction. Avoid plain basics, default neutrals, or unfinished styling.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — STYLE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const STYLE_CONFIG = {
  "Hyperrealistic": {
    label: "Hyperrealistic",
    opener: "Hyperrealistic editorial photograph, Phase One IQ4 150MP RAW capture, original fictional characters —",
    surface: "ultra-sharp pore-level skin detail, subsurface scattering, photorealistic micro-texture. RAW photograph — not CGI, not illustration, not painting.",
    tech: "Phase One IQ4 150MP, 85mm f/1.4, RAW unretouched, 8K — hyperrealistic photograph, not CGI, not painting",
  },
  "Editorial Fashion": {
    label: "Editorial Fashion",
    opener: "Vogue Italia editorial photograph, Hasselblad H6D-400C medium format RAW, luxury fashion campaign, original fictional characters —",
    surface: "photorealistic skin, razor-sharp fabric and hair detail, fashion editorial lighting precision. RAW photograph — not CGI, not illustration.",
    tech: "Hasselblad H6D-400C, 80mm, RAW, luxury editorial color grade, 8K — hyperrealistic photograph, not CGI",
  },
  "Dark Romantic": {
    label: "Dark Romantic",
    opener: "Hyperrealistic dark editorial photograph, cinematic RAW, original fictional characters —",
    surface: "cinematic photorealistic skin, deep shadow with visible texture, Kodak Portra film-grain overlay. RAW photograph — not illustration.",
    tech: "Leica S3, 70mm, RAW, Kodak Portra 400 film grain, moody desaturated grade, 8K — hyperrealistic photograph",
  },
  "Neon Futurist": {
    label: "Neon Futurist",
    opener: "Hyperrealistic cyberpunk editorial photograph, Sony A7R V RAW, neon practical lighting, original fictional characters —",
    surface: "photorealistic skin with neon color cast, sharp catchlights, practical light sourcing. RAW photograph — not CGI, not game render.",
    tech: "Sony A7R V, 35mm f/1.8, RAW, vivid neon grade, chromatic aberration, 8K — hyperrealistic photograph, not CGI",
  },
  "Golden Hour Ethereal": {
    label: "Golden Hour Ethereal",
    opener: "Hyperrealistic golden hour editorial photograph, Canon 1DX III 85mm f/1.2 RAW, backlit natural light, original fictional characters —",
    surface: "photorealistic warm-lit skin with backlit rim light, natural bokeh, soft subsurface scattering. RAW photograph.",
    tech: "Canon 1DX III, 85mm f/1.2, RAW, backlit warm grade, natural bokeh, 8K — hyperrealistic photograph",
  },
  "Gothic Opulence": {
    label: "Gothic Opulence",
    opener: "Hyperrealistic gothic editorial photograph, Phase One XT 45mm RAW, dramatic practical lighting, original fictional characters —",
    surface: "photorealistic skin in candlelight and shadow, visible pore and fabric texture, deep chiaroscuro. RAW photograph — not illustration.",
    tech: "Phase One XT, 45mm, RAW, jewel-tone grade, deep chiaroscuro, 8K — hyperrealistic photograph, not illustration",
  },
  "Chrome & Crystal": {
    label: "Chrome & Crystal",
    opener: "Hyperrealistic studio editorial photograph, Hasselblad X2D 65mm RAW, clinical strobe, prismatic flare, original fictional characters —",
    surface: "photorealistic skin reflecting prismatic light, sharp specular highlights, clinical studio focus. RAW photograph — not CGI, not 3D render.",
    tech: "Hasselblad X2D, 65mm, RAW, cold prismatic grade, studio strobe, 8K — hyperrealistic photograph, not CGI",
  },
  "Bioluminescent": {
    label: "Bioluminescent",
    opener: "Hyperrealistic bioluminescent editorial photograph, Sony A7S III 50mm f/1.4 long exposure RAW, practical glow sources, original fictional characters —",
    surface: "photorealistic skin with practical glow cast, natural subsurface scattering, long-exposure RAW. Photograph — not illustration.",
    tech: "Sony A7S III, 50mm f/1.4, long exposure RAW, deep ocean palette, practical glow, 8K — hyperrealistic photograph",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — PROMPT BEHAVIOR MODES
// ═══════════════════════════════════════════════════════════════════════════════
const PROMPT_MODES = {
  cover: {
    label: "Cover Shot",
    icon: "◈",
    desc: "Dominant subject, clean hierarchy",
    framing: "centered editorial composition, strong subject dominance, cover-image visual hierarchy, clean background separation",
    pose: "commanding, composed, photogenic posture — high control, fashion-forward, deliberate",
    environment: "visible but subordinate to the figures — world context without visual competition",
  },
  editorial: {
    label: "Editorial Hero",
    icon: "✦",
    desc: "Fashion-forward, styled moment",
    framing: "off-center editorial composition, figures integrated with world detail, intentional negative space",
    pose: "styled and deliberate — physically expressive, fashion editorial bearing, body-aware positioning",
    environment: "active environment participation — props and surfaces in direct contact with figures",
  },
  candid: {
    label: "Candid Chaos",
    icon: "◉",
    desc: "Caught raw and mid-moment",
    framing: "caught mid-action, imperfect overlap, documentary energy — not posed, not aware of camera",
    pose: "spontaneous, physically reactive, emotionally unguarded — mid-gesture, mid-laugh, mid-motion",
    environment: "active and intrusive — environment interrupting figures, figures partially obscured by world",
  },
  beauty: {
    label: "Beauty Crop",
    icon: "◎",
    desc: "Face and upper body focus",
    framing: "tight waist-up or bust crop, faces dominant, shallow depth of field, background blurred",
    pose: "intimate, expressive face and shoulder language — close physical proximity between figures",
    environment: "reduced to color and texture blur — present as atmosphere, not detail",
  },
  environment: {
    label: "Environment Hero",
    icon: "◇",
    desc: "World dominates the frame",
    framing: "wide-angle world-dominant composition — figures integrated as elements within the environment, not its center",
    pose: "interactive with architecture, props, and surfaces — climbing, perching, leaning, submerged",
    environment: "large-scale world detail must remain highly visible and fully rendered — this is the hero",
  },
  narrative: {
    label: "Narrative Duo",
    icon: "✺",
    desc: "Story tension between figures",
    framing: "figures in clear spatial relationship — one leading, one responding, or both caught in shared moment",
    pose: "physically directed toward each other — reaching, pulling, leaning in, facing off, colliding",
    environment: "active witness — world elements frame and contain the story beat",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — CAMERA MODES
// ═══════════════════════════════════════════════════════════════════════════════
const CAMERA_MODES = {
  fullBody:    { label: "Full Body",  icon: "⬜", desc: "Head to toe",     directive: "CAMERA: full-body shot — entire figure visible head to toe, feet and ground included in frame, no cropping of limbs" },
  threeQuarter:{ label: "¾ Shot",    icon: "▭",  desc: "Thigh to head",   directive: "CAMERA: three-quarter shot — frame from mid-thigh to crown, legs partially visible, no full-body or tight crop" },
  waistUp:     { label: "Waist Up",  icon: "▬",  desc: "Waist to head",   directive: "CAMERA: waist-up shot — frame from waist to crown, torso and face fully visible, nothing below the waist in frame" },
  beautyClose: { label: "Close Up",  icon: "▪",  desc: "Face and neck",   directive: "CAMERA: tight beauty close-up — face and neck only, very shallow depth of field, background fully blurred, no body below shoulders" },
  wide:        { label: "Wide",      icon: "⬛",  desc: "World + figures", directive: "CAMERA: wide environmental shot — figures are small elements within a large scene, full environment visible, figures do not dominate the frame" },
  lowAngle:    { label: "Low Angle", icon: "△",  desc: "Looking up",      directive: "CAMERA: extreme low angle — camera positioned at ground level looking up at figures, figures tower against sky or ceiling, dramatic upward perspective" },
  overhead:    { label: "Overhead",  icon: "▽",  desc: "Birds eye",       directive: "CAMERA: overhead bird's eye view — camera directly above looking straight down, figures seen from above, floor/ground surface dominant" },
};

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — PROMPT BUILDER (sectioned assembly)
// ═══════════════════════════════════════════════════════════════════════════════
function buildEnvironmentBlock(worldProfile, promptMode) {
  const env = worldProfile;
  const isEnvHero = promptMode === "environment";
  const fgItems = env.props?.slice(0, 3).join(", ") || "";
  const mgItems = env.structures?.slice(0, 2).join(", ") || "";
  const bgItems = env.structures?.slice(2, 4).join(", ") || env.surfaces?.slice(0, 2).join(", ") || "";
  const textures = env.textures?.slice(0, 3).join(", ") || "";
  const palette = env.palette?.join(", ") || "";
  return `Environment [${isEnvHero ? "HERO — must be fully visible and dominant" : "fully realized"}]: render layered spatial depth with all zones visible simultaneously — foreground: ${fgItems}; midground: ${mgItems}; background: ${bgItems}. Surfaces and textures must remain readable throughout the frame: ${textures}. Color palette: ${palette}. Atmosphere: ${env.atmosphere || "immersive and specific"}.`;
}

function buildLightingBlock(worldProfile) {
  const lights = worldProfile.lightingSources || [];
  if (!lights.length) return "Lighting: cinematically motivated practical sources, motivated color temperature.";
  return `Lighting: ${lights.slice(0, 3).join(" + ")} — directional shadow behavior, emotional color temperature, motivated by the world.`;
}

function buildSubjectCompositionDirective(subjectMode, subjects, mainIdx) {
  const mainName = subjects[mainIdx]?.name || "Figure 1";
  const count = subjects.length;

  // spatial position maps — ensures every figure gets an explicit named position
  const spatialMaps = {
    1: ["center frame"],
    2: ["frame left", "frame right"],
    3: ["frame left foreground", "center midground", "frame right foreground"],
    4: ["far left", "center-left", "center-right", "far right"],
  };
  const positions = spatialMaps[Math.min(count, 4)] || spatialMaps[4];

  const figurePositions = subjects.map((s, i) => {
    const name = s.name?.trim() || `Figure ${i + 1}`;
    return `${name} at ${positions[i] || `position ${i + 1}`}`;
  }).join("; ");

  if (subjectMode === "main") {
    const others = subjects.filter((_, i) => i !== mainIdx).map((s, i) => {
      const name = s.name?.trim() || `Figure ${mainIdx === 0 ? i + 2 : i + 1}`;
      return `${name} at ${positions[mainIdx === 0 ? i + 1 : i] || "supporting position"}`;
    }).join("; ");
    return `Spatial layout: ${mainName} is the visual anchor at ${positions[mainIdx] || "center"}${others ? ` — supporting figures: ${others}` : ""}. Key light locked on ${mainName}, secondary figures integrated into scene spatially, not floating.`;
  }

  if (subjectMode === "equal") {
    return `Spatial layout: all ${count} figures share equal visual weight — ${figurePositions}. Each figure fully occupies their designated spatial zone, no overlapping or crowding. Lighting equal across all positions.`;
  }

  return `Spatial layout: all ${count} figures in dynamic interaction — ${figurePositions}. Each figure physically connected to the scene at their position — touching props, leaning on surfaces, occupying space. Organic overlap permitted at edges, peak action moment.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIB — FRAMING RULES FOR SCENE GENERATION (tells Claude what to describe)
// ═══════════════════════════════════════════════════════════════════════════════
const FRAMING_SCENE_RULES = {
  fullBody:     "FRAMING — full body: describe the entire figure head to toe. Include feet, legs, full posture, ground contact, and full environment. Poses must involve the whole body.",
  threeQuarter: "FRAMING — three-quarter: describe figures from mid-thigh to crown. Include upper legs, torso, arms, and face. Feet and ankles are NOT in frame. Poses focus on upper body and mid-body.",
  waistUp:      "FRAMING — waist-up: describe ONLY the torso, arms, and face. Nothing below the waist exists in this frame. Poses must be upper-body only — shoulder angles, arm positions, hand placement, head tilt, facial expression. Do NOT describe leg positions, foot placement, or ground contact.",
  beautyClose:  "FRAMING — beauty close-up: describe ONLY faces, necks, and shoulders. Extreme shallow depth of field. Poses are entirely about facial expression, head angle, and neck/shoulder line. No body below the shoulders. Environment reduced to color blur behind faces.",
  wide:         "FRAMING — wide environmental: figures are small within a large scene. Describe the environment in detail — architecture, space, scale. Figures are visible but do not dominate. Poses are about figures in space, not close body detail.",
  lowAngle:     "FRAMING — low angle: camera at ground level looking up. Describe what is seen from below — undersides of chins, dramatic upward silhouettes, sky or ceiling visible behind figures. Poses emphasize height, stance width, and upward-facing angles.",
  overhead:     "FRAMING — overhead bird's eye: camera directly above looking straight down. Describe what is seen from above — tops of heads, shoulders, hands, floor surface patterns. Figures may be lying, sitting, or standing but are seen from above. Ground and floor textures are dominant.",
};

function buildSceneApiPrompt(profile, cameraModeKey, isReroll, subjectCount) {
  const framingRule = FRAMING_SCENE_RULES[cameraModeKey] || FRAMING_SCENE_RULES.fullBody;
  const count = subjectCount || 2;
  const rerollNote = isReroll ? " Use completely different locations and props from any previous scenes." : "";
  const spatialNote = count >= 3
    ? `${count} figures — placed at: left foreground, center midground, right foreground. All figures physically interact with world props at their position.`
    : `${count} figures — both physically interacting with world props.`;

  return `Generate 5 scene moments for: ${profile.worldName}${rerollNote}

WORLD PROPS: ${profile.props?.slice(0,5).join(", ")}
SURFACES: ${profile.surfaces?.slice(0,3).join(", ")}
STRUCTURES: ${profile.structures?.slice(0,3).join(", ")}
LIGHTING: ${profile.lightingSources?.slice(0,2).join(", ")}

FIGURES: ${spatialNote}
FRAMING: ${framingRule}

Each scene must: name specific world props, place figures at exact positions, describe physical contact with environment.

Respond ONLY with this exact JSON (no markdown):
{"tender":{"title":"string","description":"2 sentences max","pose":"body positions only","props":["prop1","prop2"]},"chaotic":{"title":"string","description":"2 sentences max","pose":"body positions only","props":["prop1","prop2"]},"editorial":{"title":"string","description":"2 sentences max","pose":"body positions only","props":["prop1","prop2"]},"candid":{"title":"string","description":"2 sentences max","pose":"body positions only","props":["prop1","prop2"]},"unexpected":{"title":"string","description":"2 sentences max","pose":"body positions only","props":["prop1","prop2"]}}`;
}

// Rewrite scene description for tight crops — strip full-body language
function rewriteSceneForCrop(description, pose, cameraModeKey, subjects) {
  if (cameraModeKey === "beautyClose") {
    const count = subjects.length;
    const faceDesc = count === 1
      ? "Single figure face, neck, and shoulders filling the frame"
      : count === 2
        ? "Two faces side by side, necks and shoulders at frame edge"
        : `${count} faces arrayed across the frame, necks and shoulders at edges`;
    const worldMood = description.replace(/(standing|walking|sitting|kneeling|lying|pressed against|leaning on|perched|sprawled|arms? (up|raised|out|extended)|legs?|feet|ground|floor|platform|booth|surface|stepping|stride)[^,.;]*/gi, "").trim();
    const cleanMood = worldMood.length > 20 ? ` — ${worldMood.slice(0, 120)}` : "";
    return {
      description: `${faceDesc}${cleanMood}. Extreme shallow depth of field, faces sharp, everything behind reduced to colored bokeh.`,
      pose: `facial expression — ${pose.replace(/(arms?|hands?|legs?|feet|standing|sitting|kneeling|pressing|gripping|leaning)[^,.;]*/gi, "").trim() || "intense and composed"}, head angle deliberate, neck line visible`,
    };
  }
  if (cameraModeKey === "waistUp") {
    const cleanPose = pose.replace(/(legs?|feet|foot|ground|floor|stance|step|stride|kneeling|sitting|standing)[^,.;]*/gi, "").trim();
    const cleanDesc = description.replace(/(legs?|feet|foot|ground|floor|stance|step|stride|kneeling|crouching)[^,.;]*/gi, "").trim();
    return {
      description: cleanDesc,
      pose: cleanPose || pose,
    };
  }
  return { description, pose };
}

function buildGeminiPrompt({ worldProfile, concept, styleKey, promptModeKey, cameraModeKey, subjects, mainIdx, subjectMode }) {
  const style = STYLE_CONFIG[styleKey] || STYLE_CONFIG["Hyperrealistic"];
  const mode = PROMPT_MODES[promptModeKey] || PROMPT_MODES.cover;
  const camera = CAMERA_MODES[cameraModeKey] || CAMERA_MODES.fullBody;

  // rewrite scene for tight crop modes so scene language matches framing
  const { description: sceneDesc, pose: scenePose } = rewriteSceneForCrop(concept.description, concept.pose || mode.pose, cameraModeKey, subjects);

  const figureBlocks = subjects.map((s, i) => {
    // scanned identity: stay literal — do NOT re-normalize, it blurs face specificity
    const normalized = s.scanned ? s.appearance : normalizeAppearance(s.appearance);
    const archetype = generateArchetype(s.name, normalized || s.appearance || "");
    const appearanceStr = normalized || `appearance determined by ${worldProfile.worldName} world and ${style.label} aesthetic`;
    const wardrobe = buildWardrobeBlock(s, worldProfile.worldName, style.label, cameraModeKey);
    // identity role indicators
    const hasRef = s.photo || s.detailPhoto;
    const refNote = hasRef ? `[attach reference image in Gemini for identity fidelity]` : `[no reference image — identity generated from description]`;
    return `FIGURE ${i + 1} [${archetype}] ${refNote} | appearance: ${appearanceStr} | ${wardrobe}`;
  }).join("  //  ");

  const hasAnyRef = subjects.some(s => s.photo || s.detailPhoto);
  const referenceBlock = hasAnyRef
    ? `Reference fidelity: use attached reference image(s) as identity anchors. Preserve the same facial structure, eye area, nose, lips, jawline, skin tone, hairline, and overall identity. Do not substitute a different person or reinterpret into a generic face. If an additional detail reference is attached, use it only for tattoo design, body art placement, or styling fidelity — not to override facial identity.`
    : null;

  const sections = [
    style.opener,
    referenceBlock,
    camera.directive,
    `Strict framing enforcement: ${FRAMING_SCENE_RULES[cameraModeKey] || FRAMING_SCENE_RULES.fullBody} — do not render any body part or detail that falls outside this crop. Any body part outside the frame does not exist.`,
    `Scene: ${sceneDesc}`,
    `Pose language: ${scenePose}`,
    `Composition: ${mode.framing}`,
    buildSubjectCompositionDirective(subjectMode, subjects, mainIdx),
    `FIGURES — all must be fully rendered with exact outfits, no exceptions: ${figureBlocks}`,
    buildEnvironmentBlock(worldProfile, promptModeKey),
    buildLightingBlock(worldProfile),
    style.surface,
    "All figures are entirely original fictional characters — not likenesses of any real individual.",
    style.tech,
    "--ar 4:5, --style raw, --q 2",
  ];

  return sections.filter(Boolean).join("  ");
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  bg: "#05050d", surface: "rgba(255,255,255,0.025)", border: "rgba(255,255,255,0.065)",
  borderHover: "rgba(255,255,255,0.12)", gold: "#f0b429", pink: "#ff4d8d",
  purple: "#9b59f5", green: "rgba(80,255,140,0.85)", text: "rgba(255,255,255,0.86)",
  muted: "rgba(255,255,255,0.32)", faint: "rgba(255,255,255,0.04)",
};

const inp = {
  background: C.faint, border: `1px solid ${C.border}`, borderRadius: "10px",
  padding: "10px 14px", color: C.text, fontSize: "13px", width: "100%",
  outline: "none", fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box",
  transition: "border-color 0.2s", lineHeight: 1.5,
};
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: "20px", padding: "22px" };

function SLabel({ step, children, color }) {
  return (
    <div style={{ fontSize: "9.5px", letterSpacing: "3px", color: color || "rgba(240,180,41,0.55)", fontWeight: "700", fontFamily: "'DM Sans', sans-serif" }}>
      {step && <span style={{ opacity: 0.35, marginRight: "8px" }}>{step}</span>}{children}
    </div>
  );
}

function Pill({ active, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? "5px 11px" : "7px 15px", borderRadius: "20px",
      border: `1px solid ${active ? "rgba(155,89,245,0.5)" : C.border}`,
      background: active ? "rgba(155,89,245,0.12)" : "transparent",
      color: active ? "rgba(200,160,255,0.9)" : C.muted,
      fontSize: small ? "10px" : "11px", cursor: "pointer",
      fontFamily: "'DM Sans', sans-serif", fontWeight: "600",
      letterSpacing: "0.3px", transition: "all 0.18s",
    }}>{children}</button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINI PHOTO SLOT (reusable — used for face ref + detail ref)
// ═══════════════════════════════════════════════════════════════════════════════
function PhotoSlot({ photo, label, sublabel, accentColor, onFile, onClear, badge, children }) {
  const ref = useRef();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flexShrink: 0 }}>
      <div style={{ fontSize: "7.5px", letterSpacing: "1.5px", color: accentColor || C.muted, fontWeight: "700", fontFamily: "'DM Sans',sans-serif", textAlign: "center", marginBottom: 1 }}>{label}</div>
      <div onClick={() => ref.current.click()} style={{ width: "72px", height: "72px", borderRadius: "12px", border: `2px dashed ${photo ? "transparent" : "rgba(255,255,255,0.09)"}`, background: photo ? "transparent" : C.faint, cursor: "pointer", overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f?.type.startsWith("image/")) { const r = new FileReader(); r.onload = () => onFile(r.result); r.readAsDataURL(f); }}} />
        {photo ? (
          <>
            <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {badge && <div style={{ position: "absolute", bottom: 3, right: 3, background: badge.bg, borderRadius: "20px", padding: "1px 5px", fontSize: "7px", color: badge.color, fontWeight: 800, fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>{badge.label}</div>}
          </>
        ) : (
          <div style={{ textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: 15, opacity: 0.25, marginBottom: 2 }}>⊕</div>
            <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.8px", lineHeight: 1.4 }}>{sublabel || "ADD"}</div>
          </div>
        )}
      </div>
      {photo && <button onClick={onClear} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.16)", fontSize: 8, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>✕ clear</button>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBJECT CARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
function SubjectCard({ subject, index, onChange, onRemove, isMain, onSetMain }) {
  const [scanning, setScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);

  async function scanPhoto() {
    if (!subject.photo || scanning) return;
    setScanning(true); setScanFailed(false);
    try {
      const base64 = subject.photo.split(",")[1];
      const mediaType = subject.photo.split(";")[0].split(":")[1];
      const res = await fetch(API_URL, {
        method: "POST",
        headers: (isClaudeAI ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : { "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 800,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Analyze this reference image and write a precise identity anchor for image generation. Describe ONLY permanent physical traits — ignore all clothing, accessories, and styling entirely. Describe: face shape, forehead width/height, brow shape and spacing, eye shape and inter-eye distance, nose shape and bridge, lip shape and fullness, cheek structure, jawline, chin shape, hairline shape, hair color (specific shade), hair texture and length, skin tone in neutral photographic terms (luminosity and undertone), body build and bare silhouette, any visible tattoos with exact anatomical placement, piercings with location. Do not describe, reference, or imply any clothing, outfit, fabric, shoes, or non-piercing accessories — wardrobe will be assigned separately. Facial and body piercings are permanent physical traits and must be retained. Be literal, specific, and identity-preserving. Do not mention ethnicity, nationality, attractiveness, or real-person references. Output only one dense comma-separated description. Max 110 words." }
          ]}]
        })
      });
      if (!res.ok) throw new Error("fail");
      const data = await res.json();
      const desc = data.content?.map(b => b.text || "").join("").trim() || "";
      if (!desc) throw new Error("empty");
      onChange({ ...subject, appearance: desc, scanned: true });
    } catch { setScanFailed(true); }
    setScanning(false);
  }

  const weakIdentity = !subject.appearance?.trim() && !subject.photo;

  return (
    <div style={{
      background: isMain ? "linear-gradient(135deg,rgba(240,180,41,0.06),rgba(255,77,141,0.04))" : C.surface,
      border: `1px solid ${isMain ? "rgba(240,180,41,0.25)" : C.border}`,
      borderRadius: "16px", padding: "17px", position: "relative", transition: "all 0.3s",
    }}>
      {isMain && (
        <div style={{ position: "absolute", top: "-10px", left: "16px", background: `linear-gradient(90deg,${C.gold},${C.pink})`, borderRadius: "20px", padding: "2px 11px", fontSize: "8px", letterSpacing: "2.5px", color: "#05050d", fontWeight: "800", fontFamily: "'DM Sans',sans-serif" }}>MAIN CHARACTER</div>
      )}

      {/* ── reference photos row ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        {/* Face Reference */}
        <PhotoSlot
          photo={subject.photo} label="FACE REF" sublabel="IDENTITY"
          accentColor="rgba(255,77,141,0.6)"
          onFile={img => onChange({ ...subject, photo: img, scanned: false })}
          onClear={() => onChange({ ...subject, photo: null, scanned: false })}
          badge={subject.photo ? { label: "ATTACH IN GEMINI", bg: "rgba(255,77,141,0.85)", color: "#fff" } : null}
        >
          {subject.photo && !scanning && (
            <button onClick={scanPhoto} style={{ background: subject.scanned ? "rgba(80,255,140,0.07)" : "rgba(155,89,245,0.1)", border: `1px solid ${subject.scanned ? "rgba(80,255,140,0.2)" : "rgba(155,89,245,0.25)"}`, borderRadius: "7px", padding: "3px 0", width: "72px", fontSize: "8px", cursor: "pointer", letterSpacing: "0.8px", color: subject.scanned ? C.green : "rgba(200,160,255,0.85)", fontFamily: "'DM Sans',sans-serif", fontWeight: "700" }}>
              {subject.scanned ? "✓ SCANNED" : "✦ SCAN"}
            </button>
          )}
          {scanning && <div style={{ fontSize: 7.5, color: C.pink, letterSpacing: "1px", fontFamily: "'DM Sans',sans-serif", animation: "sp-pulse 1.2s ease-in-out infinite" }}>SCANNING…</div>}
          {scanFailed && !scanning && <div style={{ fontSize: 7.5, color: "rgba(255,80,80,0.55)", textAlign: "center", fontFamily: "'DM Sans',sans-serif" }}>unavail.</div>}
        </PhotoSlot>

        {/* Detail Reference */}
        <PhotoSlot
          photo={subject.detailPhoto} label="DETAIL REF" sublabel="TATTOO / STYLE"
          accentColor="rgba(155,89,245,0.6)"
          onFile={img => onChange({ ...subject, detailPhoto: img })}
          onClear={() => onChange({ ...subject, detailPhoto: null })}
          badge={subject.detailPhoto ? { label: "ATTACH IN GEMINI", bg: "rgba(155,89,245,0.85)", color: "#fff" } : null}
        />

        {/* workflow note */}
        <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: "11px", padding: "9px 11px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: "8.5px", color: "rgba(240,180,41,0.6)", fontWeight: "700", letterSpacing: "1px", fontFamily: "'DM Sans',sans-serif", marginBottom: 4 }}>REFERENCE WORKFLOW</div>
          <div style={{ fontSize: "9.5px", color: C.muted, lineHeight: 1.6, fontFamily: "'DM Sans',sans-serif" }}>
            Upload refs here to scan identity anchor text. <span style={{ color: "rgba(255,255,255,0.45)" }}>Attach the same images in Gemini</span> for true identity lock — text alone can't preserve a face.
          </div>
        </div>
      </div>

      {/* ── identity fields ── */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: 7 }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg,${C.pink},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "white", fontFamily: "'Playfair Display',serif" }}>{index + 1}</div>
        <input value={subject.name} onChange={e => onChange({ ...subject, name: e.target.value })} placeholder="Name or alias…" style={{ ...inp, flex: 1 }} />
      </div>
      <textarea value={subject.appearance} onChange={e => onChange({ ...subject, appearance: e.target.value, scanned: false })} placeholder={subject.photo ? "Face Ref uploaded → hit ✦ SCAN to auto-generate identity anchor, or type manually." : "Identity anchor — face shape, brow structure, eye shape, nose, lips, jaw, hair exact shade + texture, skin tone, tattoos with placement, piercings, build. Be literal and specific."} rows={3} style={{ ...inp, resize: "none", lineHeight: 1.65, borderColor: subject.scanned ? "rgba(80,255,140,0.18)" : C.border, marginBottom: 7 }} />

      {/* weak identity warning */}
      {weakIdentity && (
        <div style={{ fontSize: "9.5px", color: "rgba(240,180,41,0.5)", fontFamily: "'DM Sans',sans-serif", marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}>
          <span>⚠</span> No identity anchor — Gemini will invent this figure's appearance. Add description or scan a photo for stability.
        </div>
      )}

      <textarea value={subject.wardrobe} onChange={e => onChange({ ...subject, wardrobe: e.target.value })} placeholder="Wardrobe — specific garments, fabric, silhouette, shoes, jewelry, nails, hair, makeup. Leave blank to auto-generate from event world." rows={2} style={{ ...inp, resize: "none", lineHeight: 1.65, borderColor: subject.wardrobe?.trim() ? "rgba(240,180,41,0.2)" : C.border, marginBottom: 7 }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => onSetMain(index)} style={{ background: "transparent", border: `1px solid ${isMain ? "rgba(240,180,41,0.3)" : C.border}`, borderRadius: "20px", padding: "3px 10px", fontSize: 9.5, cursor: "pointer", color: isMain ? C.gold : C.muted, fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.3px" }}>{isMain ? "★ Main" : "☆ Set Main"}</button>
        {index > 0 && <button onClick={onRemove} style={{ background: "transparent", border: "1px solid rgba(255,60,80,0.15)", borderRadius: "20px", padding: "3px 10px", fontSize: 9.5, cursor: "pointer", color: "rgba(255,80,100,0.5)", fontFamily: "'DM Sans',sans-serif" }}>✕ Remove</button>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE SLOT CARD
// ═══════════════════════════════════════════════════════════════════════════════
const SLOT_COLORS = {
  tender:     { label: "TENDER",     color: "#f0b429", glow: "rgba(240,180,41,0.15)"  },
  chaotic:    { label: "CHAOTIC",    color: "#ff4d8d", glow: "rgba(255,77,141,0.15)"  },
  editorial:  { label: "EDITORIAL",  color: "#9b59f5", glow: "rgba(155,89,245,0.15)"  },
  candid:     { label: "CANDID",     color: "#22d3ee", glow: "rgba(34,211,238,0.15)"  },
  unexpected: { label: "UNEXPECTED", color: "#50ff8c", glow: "rgba(80,255,140,0.15)"  },
};

function SceneSlotCard({ slotKey, concept, selected, onClick }) {
  const meta = SLOT_COLORS[slotKey];
  return (
    <button onClick={onClick} style={{
      background: selected ? meta.glow : "rgba(255,255,255,0.018)",
      border: `1px solid ${selected ? meta.color + "55" : "rgba(255,255,255,0.055)"}`,
      borderRadius: "14px", padding: "15px 17px", cursor: "pointer",
      textAlign: "left", width: "100%", transition: "all 0.2s", position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: 7 }}>
        <span style={{ fontSize: "8.5px", letterSpacing: "2px", fontWeight: "800", fontFamily: "'DM Sans',sans-serif", color: meta.color, padding: "2px 8px", borderRadius: "20px", border: `1px solid ${meta.color}33`, background: meta.glow, flexShrink: 0, marginTop: 1 }}>{meta.label}</span>
        <span style={{ fontSize: "13px", fontWeight: "700", color: selected ? "white" : "rgba(255,255,255,0.72)", fontFamily: "'Playfair Display',serif", lineHeight: 1.3, paddingRight: 24 }}>{concept.title}</span>
        {selected && <div style={{ position: "absolute", top: 13, right: 13, width: 17, height: 17, borderRadius: "50%", background: `linear-gradient(135deg,${C.pink},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, color: "white", fontWeight: 800 }}>✓</div>}
      </div>
      <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.68, fontFamily: "'DM Sans',sans-serif", marginBottom: 8 }}>{concept.description}</div>
      {concept.props?.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {concept.props.map(p => (
            <span key={p} style={{ fontSize: "9px", padding: "2px 7px", borderRadius: "20px", background: selected ? meta.glow : "rgba(255,255,255,0.04)", color: selected ? meta.color : C.muted, border: `1px solid ${selected ? meta.color + "30" : "transparent"}`, fontFamily: "'DM Sans',sans-serif", fontWeight: "600" }}>{p}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD DNA DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════
function WorldDNAPanel({ profile, collapsed, onToggle }) {
  const sections = [
    { key: "props",          label: "PROPS",      color: C.pink   },
    { key: "surfaces",       label: "SURFACES",   color: C.gold   },
    { key: "structures",     label: "STRUCTURES", color: C.purple },
    { key: "lightingSources",label: "LIGHTING",   color: "#22d3ee" },
    { key: "textures",       label: "TEXTURES",   color: "#50ff8c" },
    { key: "palette",        label: "PALETTE",    color: "#f97316" },
  ];
  return (
    <div style={{ background: "rgba(255,255,255,0.018)", border: `1px solid ${C.border}`, borderRadius: "14px", overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", padding: "13px 18px", background: "transparent", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <SLabel color="rgba(80,255,140,0.6)">WORLD DNA</SLabel>
          <span style={{ fontSize: "10px", color: C.muted, fontFamily: "'DM Sans',sans-serif" }}>{profile.worldName}</span>
        </div>
        <span style={{ color: C.muted, fontSize: "11px", fontFamily: "'DM Sans',sans-serif" }}>{collapsed ? "▼ expand" : "▲ collapse"}</span>
      </button>
      {!collapsed && (
        <div style={{ padding: "0 18px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          {sections.map(({ key, label, color }) => (
            profile[key]?.length > 0 && (
              <div key={key}>
                <div style={{ fontSize: "8px", letterSpacing: "2px", color: color, fontWeight: "700", fontFamily: "'DM Sans',sans-serif", marginBottom: "5px", opacity: 0.7 }}>{label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {profile[key].map(item => (
                    <div key={item} style={{ fontSize: "10.5px", color: C.muted, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4 }}>· {item}</div>
                  ))}
                </div>
              </div>
            )
          ))}
          {profile.atmosphere && (
            <div style={{ gridColumn: "1/-1", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: "8px", letterSpacing: "2px", color: "rgba(155,89,245,0.6)", fontWeight: "700", fontFamily: "'DM Sans',sans-serif", marginRight: 8 }}>ATMOSPHERE</span>
              <span style={{ fontSize: "11px", color: C.muted, fontFamily: "'DM Sans',sans-serif", fontStyle: "italic" }}>{profile.atmosphere}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
const STYLE_PRESETS = Object.keys(STYLE_CONFIG);
const SLOT_ORDER = ["tender","chaotic","editorial","candid","unexpected"];

export default function App() {
  const [tab, setTab]             = useState("setup");
  const [eventDesc, setEventDesc] = useState("");

  // world DNA
  const [worldProfile, setWorldProfile]     = useState(null);
  const [worldLoading, setWorldLoading]     = useState(false);
  const [dnaPanelOpen, setDnaPanelOpen]     = useState(false);

  // scenes
  const [sceneSlots, setSceneSlots]         = useState(null);
  const [scenesLoading, setScenesLoading]   = useState(false);
  const [selectedSlot, setSelectedSlot]     = useState(null);

  // controls
  const [styleKey, setStyleKey]             = useState("Hyperrealistic");
  const [promptModeKey, setPromptModeKey]   = useState("cover");
  const [cameraModeKey, setCameraModeKey]   = useState("fullBody");
  const [subjectMode, setSubjectMode]       = useState("equal");
  const [mainIdx, setMainIdx]               = useState(0);

  // subjects
  const [subjects, setSubjects]             = useState([
    { name: "", appearance: "", wardrobe: "", photo: null, detailPhoto: null, scanned: false },
    { name: "", appearance: "", wardrobe: "", photo: null, detailPhoto: null, scanned: false },
  ]);

  // output
  const [prompt, setPrompt]                 = useState("");
  const [shortPrompt, setShortPrompt]       = useState("");
  const [copied, setCopied]                 = useState(false);
  const [copiedShort, setCopiedShort]       = useState(false);
  const [showShort, setShowShort]           = useState(false);

  const timerRef = useRef(null);

  // ── world DNA + scenes generation ──
  const generateWorldAndScenes = useCallback(async (desc, cameraKey = "fullBody", subjectCount = 1) => {
    if (!desc.trim() || desc.trim().length < 5) {
      setWorldProfile(null); setSceneSlots(null); setSelectedSlot(null);
      setWorldLoading(false); setScenesLoading(false);
      return;
    }
    setWorldLoading(true); setScenesLoading(true);
    setSceneSlots(null); setSelectedSlot(null);

    // Step 1: generate world DNA
    let profile = null;
    let apiError = null;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: (isClaudeAI ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : { "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 900,
          messages: [{ role: "user", content: `Build the physical world DNA for this event: "${desc.trim()}"

Respond ONLY with valid JSON, no markdown, no backticks:
{"worldName":"string","atmosphere":"string","surfaces":["string x5"],"structures":["string x4"],"props":["string x7"],"lightingSources":["string x4"],"textures":["string x4"],"palette":["string x5"]}

Rules: be hyper-specific to THIS exact event. Every item must be a physical object, surface, or real light source that exists in this world and nowhere else. No generic terms.` }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.content?.map(b => b.text || "").join("").trim();
        const parsed = extractJSON(raw);
        if (isValidWorldProfile(parsed)) { profile = parsed; profile.worldName = desc.trim(); }
        else { apiError = "API responded but JSON was invalid: " + raw?.slice(0, 120); }
      } else {
        const errData = await res.json().catch(() => ({}));
        apiError = `API error ${res.status}: ${errData?.error?.message || JSON.stringify(errData).slice(0, 120)}`;
      }
    } catch(e) { apiError = "Fetch failed: " + e.message; }
    if (apiError) console.error("[SP World DNA]", apiError);
    if (!profile) profile = getFallbackWorldProfile(desc);
    setWorldProfile(profile);
    setWorldLoading(false);

    // Step 2: generate scene slots from world DNA
    let slots = null;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: (isClaudeAI ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : { "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 2000,
          messages: [{ role: "user", content: buildSceneApiPrompt(profile, cameraKey, false, subjectCount) }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.content?.map(b => b.text || "").join("").trim();
        const parsed = extractJSON(raw);
        if (isValidSceneSlots(parsed)) slots = parsed;
      }
    } catch {}
    if (!slots) slots = getFallbackScenes(desc, subjectCount);
    setSceneSlots(slots);
    setScenesLoading(false);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => generateWorldAndScenes(eventDesc, cameraModeKey, subjects.length), 900);
    return () => clearTimeout(timerRef.current);
  }, [eventDesc, generateWorldAndScenes]);

  // Regenerate scenes when camera framing changes (scenes must match framing)
  const prevCameraRef = useRef(cameraModeKey);
  useEffect(() => {
    if (prevCameraRef.current === cameraModeKey) return;
    prevCameraRef.current = cameraModeKey;
    if (!worldProfile || !eventDesc.trim()) return;
    rerollScenesForCamera(cameraModeKey, subjects.length);
  }, [cameraModeKey]);

  // Regenerate scenes when subject count changes — but ONLY on add/remove, not on field edits
  const prevSubjectCountRef = useRef(subjects.length);
  const subjectRerollTimer = useRef(null);
  useEffect(() => {
    const newCount = subjects.length;
    if (prevSubjectCountRef.current === newCount) return; // count unchanged, just a field edit
    prevSubjectCountRef.current = newCount;
    if (!worldProfile || !eventDesc.trim() || scenesLoading) return;
    // debounce to avoid firing mid-render
    if (subjectRerollTimer.current) clearTimeout(subjectRerollTimer.current);
    subjectRerollTimer.current = setTimeout(() => {
      rerollScenesForCamera(cameraModeKey, newCount);
    }, 1200);
    return () => clearTimeout(subjectRerollTimer.current);
  }, [subjects.length]);

  async function rerollScenesForCamera(cameraKey, subjectCount) {
    if (!worldProfile) return;
    setScenesLoading(true);
    // do NOT null out sceneSlots — keep existing scenes visible while loading
    let slots = null;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: (isClaudeAI ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : { "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 2000,
          messages: [{ role: "user", content: buildSceneApiPrompt(worldProfile, cameraKey, false, subjectCount || 1) }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.content?.map(b => b.text || "").join("").trim();
        const parsed = extractJSON(raw);
        if (isValidSceneSlots(parsed)) slots = parsed;
      }
    } catch {}
    if (!slots) slots = getFallbackScenes(worldProfile.worldName, subjectCount || 1);
    setSceneSlots(slots);
    setSelectedSlot(null);
    setScenesLoading(false);
  }

  async function rerollScenes() {
    if (!worldProfile) return;
    setScenesLoading(true);
    let slots = null;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: (isClaudeAI ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : { "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 2000,
          messages: [{ role: "user", content: buildSceneApiPrompt(worldProfile, cameraModeKey, true, subjects.length) }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.content?.map(b => b.text || "").join("").trim();
        const parsed = extractJSON(raw);
        if (isValidSceneSlots(parsed)) slots = parsed;
      }
    } catch {}
    if (!slots) slots = getFallbackScenes(worldProfile.worldName, subjectCount || 1);
    setSceneSlots(slots);
    setScenesLoading(false);
  }

  function updateSubject(i, val) { setSubjects(s => s.map((x, idx) => idx === i ? val : x)); }
  function removeSubject(i) {
    setSubjects(prev => {
      const next = prev.filter((_, idx) => idx !== i);
      setMainIdx(curr => {
        if (next.length === 0) return 0;
        if (curr === i) return 0;
        if (curr > i) return curr - 1;
        if (curr >= next.length) return 0;
        return curr;
      });
      return next;
    });
  }
  function addSubject() { setSubjects(s => [...s, { name: "", appearance: "", wardrobe: "", photo: null, detailPhoto: null, scanned: false }]); }

  function handleGenerate() {
    if (!selectedSlot || !sceneSlots || !worldProfile) return;
    const concept = sceneSlots[selectedSlot];
    const full = buildGeminiPrompt({ worldProfile, concept, styleKey, promptModeKey, cameraModeKey, subjects, mainIdx, subjectMode });

    // short prompt — compact but keeps all load-bearing Gemini pieces
    const style = STYLE_CONFIG[styleKey];
    const shortFigures = subjects.map((s, i) => {
      const wardrobe = buildWardrobeBlock(s, worldProfile.worldName, style.label);
      return `Figure ${i + 1}${s.name ? ` [${s.name}]` : ""}: ${wardrobe}`;
    }).join(" // ");
    const shortEnv = `${worldProfile.props?.slice(0,3).join(", ")} — ${worldProfile.lightingSources?.slice(0,2).join(", ")}`;
    const short = [
      style.opener,
      `Scene: ${concept.description}`,
      `Pose: ${concept.pose || PROMPT_MODES[promptModeKey]?.pose}`,
      CAMERA_MODES[cameraModeKey]?.directive,
      `Environment: ${shortEnv}`,
      shortFigures,
      `${style.tech}, --ar 4:5, --style raw`,
    ].filter(Boolean).join("  ");

    setPrompt(full); setShortPrompt(short); setTab("output");
  }

  function copyText(text, setCopiedFn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => { setCopiedFn(true); setTimeout(() => setCopiedFn(false), 2500); }).catch(() => fallbackCopy(text, setCopiedFn));
      } else {
        fallbackCopy(text, setCopiedFn);
      }
    } catch { fallbackCopy(text, setCopiedFn); }
  }
  function fallbackCopy(text, setCopiedFn) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); setCopiedFn(true); setTimeout(() => setCopiedFn(false), 2500); } catch {}
    document.body.removeChild(ta);
  }
  function copyFull() { copyText(prompt, setCopied); }
  function copyShort() { copyText(shortPrompt, setCopiedShort); }

  const canGenerate = eventDesc.trim().length >= 5 && selectedSlot && sceneSlots && worldProfile;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans',sans-serif", overflowX: "hidden" }}>
      {/* ambient */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse 55% 35% at 8% 4%,rgba(155,89,245,0.07) 0%,transparent 70%),radial-gradient(ellipse 45% 28% at 92% 92%,rgba(255,77,141,0.06) 0%,transparent 60%),radial-gradient(ellipse 35% 45% at 50% 18%,rgba(240,180,41,0.03) 0%,transparent 60%)" }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "840px", margin: "0 auto", padding: "38px 18px 100px" }}>

        {/* ── HEADER ── */}
        <div style={{ textAlign: "center", marginBottom: "42px" }}>
          <div style={{ fontSize: "7.5px", letterSpacing: "6px", color: "rgba(240,180,41,0.4)", fontWeight: "700", marginBottom: "12px", fontFamily: "'DM Sans',sans-serif" }}>SINFULLY PROMPTED  ✦  CREATIVE LAB</div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontWeight: "900", margin: "0 0 10px", fontSize: "clamp(26px,5.5vw,50px)", lineHeight: 1.07, background: `linear-gradient(135deg,#fff 0%,${C.gold} 28%,${C.pink} 58%,${C.purple} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Event Universe<br />Generator  <span style={{ fontSize: "0.45em", letterSpacing: "4px", WebkitTextFillColor: "rgba(155,89,245,0.6)" }}>V2</span>
          </h1>
          <p style={{ color: C.muted, fontSize: "12.5px", maxWidth: "380px", margin: "0 auto", lineHeight: 1.75 }}>
            Type an event → world DNA builds → 5 scene slots generate → pick controls → copy your prompt.
          </p>
        </div>

        {/* ── TABS ── */}
        <div style={{ display: "flex", gap: 3, marginBottom: 24, background: "rgba(255,255,255,0.02)", borderRadius: 11, padding: 3 }}>
          {[["setup","✦  Build"],["output","◈  Output"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: 10, borderRadius: 9, border: "none", cursor: "pointer", background: tab === id ? "rgba(255,255,255,0.065)" : "transparent", color: tab === id ? "white" : C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: "1.5px", transition: "all 0.2s" }}>{lbl}</button>
          ))}
        </div>

        {/* ══════════════ SETUP TAB ══════════════ */}
        {tab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* 01 EVENT */}
            <div style={card}>
              <SLabel step="01">EVENT UNIVERSE</SLabel>
              <textarea value={eventDesc} onChange={e => setEventDesc(e.target.value)} placeholder={`Describe the event world — 'gothic cathedral rave', 'salad fingers comic con', 'futuristic rodeo at midnight', 'luxe yacht at sunset'…`} rows={3} style={{ ...inp, marginTop: 12, resize: "none", fontSize: 14, lineHeight: 1.65 }} />

              {/* world loading */}
              {worldLoading && (
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid transparent", borderTopColor: C.green, borderRightColor: C.purple, animation: "sp-spin 0.7s linear infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, letterSpacing: "2px", color: "rgba(80,255,140,0.5)", fontFamily: "'DM Sans',sans-serif" }}>BUILDING WORLD DNA…</span>
                </div>
              )}

              {/* world DNA panel */}
              {worldProfile && !worldLoading && (
                <div style={{ marginTop: 14 }}>
                  <WorldDNAPanel profile={worldProfile} collapsed={!dnaPanelOpen} onToggle={() => setDnaPanelOpen(o => !o)} />
                </div>
              )}
            </div>

            {/* 02 SCENE SLOTS */}
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <SLabel step="02">SCENE SLOT</SLabel>
                {sceneSlots && !scenesLoading && worldProfile && (
                  <button onClick={rerollScenes} style={{ background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: "20px", padding: "5px 13px", color: "rgba(100,220,255,0.8)", fontSize: 10, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 700, letterSpacing: "1px", display: "flex", alignItems: "center", gap: 5 }}>
                    ↻ REROLL
                  </button>
                )}
              </div>
              <div style={{ fontSize: "10px", color: C.muted, marginTop: 6, marginBottom: 14, lineHeight: 1.6 }}>5 fixed moods — tender, chaotic, editorial, candid, unexpected. Each built from your event's world DNA.</div>

              {scenesLoading && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                    <div style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid transparent", borderTopColor: C.pink, borderRightColor: C.purple, animation: "sp-spin 0.7s linear infinite", flexShrink: 0 }} />
                    <SLabel>GENERATING SCENE SLOTS…</SLabel>
                  </div>
                  {SLOT_ORDER.map((k, i) => (
                    <div key={k} style={{ height: 88, borderRadius: 14, background: C.faint, border: `1px solid ${C.border}`, marginBottom: 7, animation: "sp-pulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.09}s` }} />
                  ))}
                </div>
              )}

              {sceneSlots && !scenesLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {SLOT_ORDER.map(k => sceneSlots[k] && (
                    <SceneSlotCard key={k} slotKey={k} concept={sceneSlots[k]} selected={selectedSlot === k} onClick={() => setSelectedSlot(selectedSlot === k ? null : k)} />
                  ))}
                </div>
              )}

              {!sceneSlots && !scenesLoading && eventDesc.trim().length >= 5 && (
                <div style={{ textAlign: "center", padding: "30px 0", color: C.muted, fontSize: 12 }}>Type an event to generate scenes…</div>
              )}
            </div>

            {/* 03 PROMPT CONTROLS */}
            <div style={card}>
              <SLabel step="03">PROMPT CONTROLS</SLabel>

              {/* Visual Style */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: C.muted, fontFamily: "'DM Sans',sans-serif", marginBottom: 8 }}>VISUAL STYLE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {STYLE_PRESETS.map(id => (
                    <Pill key={id} active={styleKey === id} onClick={() => setStyleKey(id)}>{id}</Pill>
                  ))}
                </div>
              </div>

              {/* Behavior Mode */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: C.muted, fontFamily: "'DM Sans',sans-serif", marginBottom: 8 }}>BEHAVIOR MODE</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                  {Object.entries(PROMPT_MODES).map(([k, m]) => (
                    <button key={k} onClick={() => setPromptModeKey(k)} style={{ padding: "10px 8px", borderRadius: "11px", border: `1px solid ${promptModeKey === k ? "rgba(155,89,245,0.4)" : C.border}`, background: promptModeKey === k ? "rgba(155,89,245,0.08)" : "transparent", cursor: "pointer", textAlign: "center", transition: "all 0.18s" }}>
                      <div style={{ fontSize: "14px", marginBottom: 3 }}>{m.icon}</div>
                      <div style={{ fontSize: "10px", fontWeight: "700", color: promptModeKey === k ? "rgba(200,160,255,0.9)" : "rgba(255,255,255,0.6)", fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.2px" }}>{m.label}</div>
                      <div style={{ fontSize: "9px", color: C.muted, marginTop: 2, fontFamily: "'DM Sans',sans-serif" }}>{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera Mode */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: C.muted, fontFamily: "'DM Sans',sans-serif", marginBottom: 8 }}>CAMERA FRAMING</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(CAMERA_MODES).map(([k, m]) => (
                    <button key={k} onClick={() => setCameraModeKey(k)} style={{ padding: "7px 12px", borderRadius: "10px", border: `1px solid ${cameraModeKey === k ? "rgba(34,211,238,0.4)" : C.border}`, background: cameraModeKey === k ? "rgba(34,211,238,0.07)" : "transparent", cursor: "pointer", transition: "all 0.18s", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: "58px" }}>
                      <span style={{ fontSize: 13 }}>{m.icon}</span>
                      <span style={{ fontSize: "9.5px", fontWeight: "700", color: cameraModeKey === k ? "rgba(100,220,255,0.9)" : C.muted, fontFamily: "'DM Sans',sans-serif" }}>{m.label}</span>
                      <span style={{ fontSize: "8px", color: C.muted, fontFamily: "'DM Sans',sans-serif" }}>{m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject Mode */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: C.muted, fontFamily: "'DM Sans',sans-serif", marginBottom: 8 }}>SUBJECT FOCUS</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["main","✦ Main Character","One figure dominates"],["equal","◈ Equal Ensemble","Equal visual weight"],["candid","◉ Candid","Caught mid-moment"]].map(([k,l,d]) => (
                    <button key={k} onClick={() => setSubjectMode(k)} style={{ flex: 1, padding: "9px 6px", borderRadius: "11px", border: `1px solid ${subjectMode === k ? "rgba(240,180,41,0.3)" : C.border}`, background: subjectMode === k ? "rgba(240,180,41,0.06)" : "transparent", cursor: "pointer", textAlign: "center", transition: "all 0.18s" }}>
                      <div style={{ fontSize: "10px", fontWeight: "700", color: subjectMode === k ? C.gold : "rgba(255,255,255,0.55)", fontFamily: "'DM Sans',sans-serif" }}>{l}</div>
                      <div style={{ fontSize: "8.5px", color: C.muted, marginTop: 2, fontFamily: "'DM Sans',sans-serif" }}>{d}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 04 SUBJECTS */}
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <SLabel step="04">SUBJECTS ({subjects.length})</SLabel>
                <button onClick={addSubject} style={{ background: "rgba(155,89,245,0.08)", border: "1px solid rgba(155,89,245,0.22)", borderRadius: "20px", padding: "5px 13px", color: "rgba(170,120,255,0.8)", fontSize: 10.5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>+ Add Subject</button>
              </div>
              <div style={{ fontSize: "10px", color: C.muted, marginTop: 7, marginBottom: 13, lineHeight: 1.6 }}>
                Upload photo → ✦ SCAN for auto identity anchor. Wardrobe field: be specific — garments, fabric, shoes, jewelry, hair, makeup. Leave blank to auto-generate from event world.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {subjects.map((s, i) => (
                  <SubjectCard key={i} subject={s} index={i} onChange={val => updateSubject(i, val)} onRemove={() => removeSubject(i)} isMain={subjectMode === "main" && i === mainIdx} onSetMain={setMainIdx} />
                ))}
              </div>
            </div>

            {/* GENERATE */}
            <div>
              {sceneSlots && !selectedSlot && (
                <div style={{ textAlign: "center", fontSize: 9.5, color: "rgba(240,180,41,0.45)", letterSpacing: "2px", marginBottom: 10, fontFamily: "'DM Sans',sans-serif" }}>↑ SELECT A SCENE SLOT TO CONTINUE</div>
              )}
              <button onClick={handleGenerate} disabled={!canGenerate} style={{ width: "100%", padding: 21, background: canGenerate ? `linear-gradient(135deg,${C.pink} 0%,${C.purple} 50%,${C.gold} 100%)` : "rgba(255,255,255,0.03)", border: "none", borderRadius: 15, color: canGenerate ? "white" : "rgba(255,255,255,0.2)", fontSize: 12.5, fontWeight: 800, fontFamily: "'Playfair Display',serif", letterSpacing: "4px", cursor: canGenerate ? "pointer" : "not-allowed", transition: "all 0.3s", textTransform: "uppercase", boxShadow: canGenerate ? "0 0 50px rgba(155,89,245,0.14)" : "none" }}>
                {canGenerate ? `✦  Build Prompt — ${SLOT_COLORS[selectedSlot]?.label} ${sceneSlots[selectedSlot]?.title}` : "✦  Build Your Prompt"}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════ OUTPUT TAB ══════════════ */}
        {tab === "output" && (
          <div>
            {prompt ? (
              <div>
                <div style={{ background: "linear-gradient(135deg,rgba(255,77,141,0.07),rgba(155,89,245,0.07))", border: "1px solid rgba(255,77,141,0.18)", borderRadius: 13, padding: "13px 17px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 9.5, letterSpacing: "2px", color: C.green, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", marginBottom: 2 }}>✓ GEMINI-READY PROMPT</div>
                    <div style={{ fontSize: 10.5, color: C.muted, fontFamily: "'DM Sans',sans-serif" }}>{subjects.length} subject{subjects.length > 1 ? "s" : ""} · {styleKey} · {SLOT_COLORS[selectedSlot]?.label} · {PROMPT_MODES[promptModeKey]?.label} · {CAMERA_MODES[cameraModeKey]?.label}</div>
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button onClick={() => setShowShort(s => !s)} style={{ background: showShort ? "rgba(240,180,41,0.1)" : "transparent", border: `1px solid ${showShort ? "rgba(240,180,41,0.3)" : C.border}`, borderRadius: "20px", padding: "7px 13px", color: showShort ? C.gold : C.muted, fontSize: 10.5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>{showShort ? "FULL" : "SHORT"}</button>
                    <button onClick={showShort ? copyShort : copyFull} style={{ background: (showShort ? copiedShort : copied) ? "rgba(80,255,140,0.08)" : "rgba(255,255,255,0.05)", border: `1px solid ${(showShort ? copiedShort : copied) ? "rgba(80,255,140,0.25)" : C.border}`, borderRadius: "20px", padding: "7px 16px", color: (showShort ? copiedShort : copied) ? C.green : C.text, fontSize: 10.5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 700 }}>{(showShort ? copiedShort : copied) ? "✓  Copied!" : "⊕  Copy"}</button>
                  </div>
                </div>

                <div style={{ background: "rgba(255,255,255,0.015)", border: `1px solid ${C.border}`, borderRadius: 15, padding: "20px 22px", fontSize: 13, lineHeight: 1.85, color: "rgba(255,255,255,0.76)", fontFamily: "'DM Sans',sans-serif", userSelect: "all", whiteSpace: "pre-wrap" }}>
                  {showShort ? shortPrompt : prompt}
                </div>

                {/* Gemini workflow checklist */}
                <div style={{ background: "linear-gradient(135deg,rgba(255,77,141,0.05),rgba(155,89,245,0.05))", border: "1px solid rgba(255,77,141,0.18)", borderRadius: 13, padding: "15px 17px", marginTop: 13 }}>
                  <div style={{ fontSize: 9, letterSpacing: "2px", color: "rgba(255,77,141,0.7)", fontWeight: 700, marginBottom: 10, fontFamily: "'DM Sans',sans-serif" }}>USE IN GEMINI — CHECKLIST</div>
                  {subjects.map((s, i) => (s.photo || s.detailPhoto) && (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 9, letterSpacing: "1.5px", color: C.muted, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", marginBottom: 4 }}>FIGURE {i + 1}{s.name ? ` — ${s.name}` : ""}</div>
                      {s.photo && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}><img src={s.photo} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", border: "1px solid rgba(255,77,141,0.3)" }} /><span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontFamily: "'DM Sans',sans-serif" }}>☐ Attach <strong style={{ color: "rgba(255,150,180,0.9)" }}>Face Reference</strong> in Gemini</span></div>}
                      {s.detailPhoto && <div style={{ display: "flex", alignItems: "center", gap: 8 }}><img src={s.detailPhoto} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", border: "1px solid rgba(155,89,245,0.3)" }} /><span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontFamily: "'DM Sans',sans-serif" }}>☐ Attach <strong style={{ color: "rgba(180,140,255,0.9)" }}>Detail Reference</strong> in Gemini</span></div>}
                    </div>
                  ))}
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 6 }}>
                    <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.85, fontFamily: "'DM Sans',sans-serif" }}>
                      ☐ Open <strong style={{ color: "rgba(255,255,255,0.55)" }}>Gemini → Imagen 3</strong><br/>
                      ☐ Attach reference images above<br/>
                      ☐ Paste the prompt and generate<br/>
                    </div>
                  </div>
                </div>

                <div style={{ background: "rgba(240,180,41,0.03)", border: "1px solid rgba(240,180,41,0.1)", borderRadius: 13, padding: "14px 17px", marginTop: 10 }}>
                  <div style={{ fontSize: 9, letterSpacing: "2px", color: "rgba(240,180,41,0.5)", fontWeight: 700, marginBottom: 7, fontFamily: "'DM Sans',sans-serif" }}>TROUBLESHOOTING</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.9, fontFamily: "'DM Sans',sans-serif" }}>
                    Soft block? Prepend: <span style={{ color: C.gold }}>"Editorial photograph, original fictional characters, not based on any real person —"</span><br/>
                    Identity drifting? Attach reference images + add more literal structure to appearance anchor<br/>
                    Outfit dropping? Fill wardrobe field — specific garments always beat blank<br/>
                    Face changing? Text alone cannot lock a face — attach the same Face Ref in Gemini
                  </div>
                </div>

                <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
                  <button onClick={() => setTab("setup")} style={{ flex: 1, padding: 11, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 11, color: C.muted, fontSize: 10.5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: "2px" }}>← BACK</button>
                  <button onClick={() => { setPrompt(""); setShortPrompt(""); setSelectedSlot(null); setTab("setup"); }} style={{ flex: 1, padding: 11, background: "transparent", border: "1px solid rgba(255,77,141,0.15)", borderRadius: 11, color: "rgba(255,77,141,0.45)", fontSize: 10.5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: "2px" }}>↺ NEW SCENE</button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "90px 0", color: C.muted }}>
                <div style={{ fontSize: 40, marginBottom: 13, opacity: 0.15 }}>✦</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16 }}>No prompt yet.</div>
                <div style={{ fontSize: 11, marginTop: 7, letterSpacing: "1px" }}>Build tab → type event → pick scene → generate.</div>
                <button onClick={() => setTab("setup")} style={{ marginTop: 18, background: "transparent", border: `1px solid ${C.border}`, borderRadius: "20px", padding: "7px 18px", color: C.muted, fontSize: 10.5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: "1.5px" }}>← Go to Build</button>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.14); }
        input:focus, textarea:focus { border-color: rgba(155,89,245,0.32) !important; }
        button:active { transform: scale(0.98); }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
        @keyframes sp-pulse { 0%,100% { opacity: 0.25; } 50% { opacity: 0.6; } }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(155,89,245,0.18); border-radius: 2px; }
      `}</style>
    </div>
  );
}
