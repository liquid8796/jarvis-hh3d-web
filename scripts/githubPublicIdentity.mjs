import { createHash } from "node:crypto";

/**
 * Public-facing copy for the hosted repositories.
 *
 * The prose is a deliberately finite, reviewed corpus: free-form text generated during a
 * release would change on every deploy and make the payload non-idempotent. A SHA-256 digest of
 * the private identity selects one topic, wording variant, layout and pair of display labels.
 * The private identity is never interpolated into the result.
 *
 * THEMES, layouts, ABOUT_OPENERS and LABEL_SUFFIXES are a frozen v1 compatibility corpus.
 * Do not edit, reorder or resize them: modulo selection would remap existing repositories.
 * A future corpus must use a new versioned salt and an explicit migration.
 */

export const PUBLIC_WORKFLOW_NAME_PLACEHOLDER = "__PUBLIC_WORKFLOW_NAME__";
export const PUBLIC_JOB_NAME_PLACEHOLDER = "__PUBLIC_JOB_NAME__";

const THEMES = Object.freeze([
  Object.freeze({
    id: "tide-pools",
    title: "A Pocket Guide to Tide Pools",
    about: "tide pools, shoreline textures, and the small lives revealed by a falling tide",
    lede: "A receding tide turns an ordinary shelf of rock into a chain of clear, temporary windows.",
    notes: Object.freeze([
      "Sea anemones fold inward when the water thins, then open again beneath the next ripple.",
      "Hermit crabs favor shaded crevices where temperature and salinity change more slowly.",
      "Green sea lettuce marks the brighter edges, while barnacles hold fast above the deepest cups.",
    ]),
    coda: "The best observations come from patience, soft footsteps, and leaving every stone where it was found.",
    label: "Tide Pool",
    activities: Object.freeze(["Reading the rock pools", "Noting life between stones", "Following the falling tide", "Sorting shoreline colors"]),
  }),
  Object.freeze({
    id: "winter-sky",
    title: "Winter Sky Notes",
    about: "bright winter constellations, patient stargazing, and the shapes found between familiar stars",
    lede: "Cold air often sharpens the night sky, making a handful of bright stars feel close enough to arrange by hand.",
    notes: Object.freeze([
      "Orion is easiest to find by its three nearly even belt stars.",
      "Sirius sits low and brilliant, flashing many colors when the air is restless.",
      "The Pleiades look like a tiny mist at first and separate into pinpoints after a quiet minute.",
    ]),
    coda: "A dark doorway and ten unhurried minutes are enough for the eye to discover far more than it saw at first.",
    label: "Winter Sky",
    activities: Object.freeze(["Tracing the bright constellations", "Watching the eastern horizon", "Comparing starlight colors", "Finding shapes after dusk"]),
  }),
  Object.freeze({
    id: "tea-leaves",
    title: "Tea Leaves and Quiet Cups",
    about: "tea leaves, water temperature, and the subtle aromas that emerge in a quiet cup",
    lede: "The same handful of leaves can taste floral, toasted, grassy, or mineral as the water and steeping style change.",
    notes: Object.freeze([
      "Whole leaves usually open gradually and reward several short infusions.",
      "Cooler water preserves delicate aromas that boiling water can flatten.",
      "An empty warmed cup often holds the clearest trace of the tea's fragrance.",
    ]),
    coda: "Tasting slowly is less about finding the correct answer than noticing what changed since the previous cup.",
    label: "Tea Leaf",
    activities: Object.freeze(["Comparing fragrant leaves", "Listening to the kettle", "Tasting the second cup", "Noting color and aroma"]),
  }),
  Object.freeze({
    id: "city-trees",
    title: "Trees Along the Sidewalk",
    about: "city trees, changing bark, and the pockets of shade they lend to familiar streets",
    lede: "Street trees record a neighborhood in rings, scars, roots, and canopies that shift with every season.",
    notes: Object.freeze([
      "London plane trees shed pale flakes of bark that reveal a patchwork trunk.",
      "Ginkgo leaves turn almost all at once, carpeting the pavement in fan-shaped gold.",
      "Young roots follow seams in the soil where rain and air can still reach them.",
    ]),
    coda: "Learning a few leaf shapes can make a daily walk feel like a return to many old acquaintances.",
    label: "City Tree",
    activities: Object.freeze(["Reading leaves along the avenue", "Comparing bark and shade", "Walking beneath the canopy", "Finding green corners"]),
  }),
  Object.freeze({
    id: "clay-glazes",
    title: "Clay, Fire, and Glaze",
    about: "handmade ceramics, subtle glaze surfaces, and the marks left by clay and heat",
    lede: "A finished bowl carries evidence of wet hands, mineral color, and a kiln atmosphere that can never be repeated exactly.",
    notes: Object.freeze([
      "Speckled stoneware reveals iron-rich grains after firing.",
      "A thin glaze breaks lighter across rims and carved lines.",
      "Small variations at the foot often say more about the maker than a perfectly smooth wall.",
    ]),
    coda: "The charm of studio pottery lies in useful forms that still preserve the touch of their making.",
    label: "Clay and Glaze",
    activities: Object.freeze(["Studying glaze surfaces", "Comparing clay textures", "Looking closely at fired color", "Tracing marks in stoneware"]),
  }),
  Object.freeze({
    id: "cloud-atlas",
    title: "An Everyday Cloud Atlas",
    about: "cloud shapes, changing light, and simple clues carried across an open sky",
    lede: "Clouds make the movement of invisible air visible, from thin ice feathers to deep towers edged in sunlight.",
    notes: Object.freeze([
      "Cirrus arrives high and fibrous, often with delicate hooked ends.",
      "Fair-weather cumulus keeps a level gray base beneath its bright domes.",
      "Altocumulus gathers into rippled patches sometimes called a mackerel sky.",
    ]),
    coda: "Names are useful, but the richer habit is noticing height, texture, direction, and the color of the light.",
    label: "Cloud Atlas",
    activities: Object.freeze(["Reading shapes in the sky", "Comparing cloud edges", "Watching light cross the clouds", "Noting wind above the rooftops"]),
  }),
  Object.freeze({
    id: "bookbinding",
    title: "Paper, Thread, and Fold",
    about: "bookbinding details, folded paper, and the quiet craft hidden inside a well-made volume",
    lede: "Before a book becomes a single object, it is a gathering of sheets, folds, thread, board, cloth, and careful alignment.",
    notes: Object.freeze([
      "The grain of paper should usually lie parallel to the spine so pages open without resistance.",
      "A crisp bone-folder crease gives each section an even edge.",
      "Visible sewing can be structural and decorative at the same time.",
    ]),
    coda: "A modest handmade binding invites attention to the weight, sound, and movement of pages in the hand.",
    label: "Bookbinder's",
    activities: Object.freeze(["Folding a fresh section", "Following thread through paper", "Comparing paper grain", "Studying the shape of a spine"]),
  }),
  Object.freeze({
    id: "forest-mushrooms",
    title: "Mushrooms After Rain",
    about: "woodland mushrooms, damp weather, and the fleeting forms that appear after rain",
    lede: "A wet week can bring an entire hidden landscape to the surface: caps, cups, fans, corals, and tiny umbrellas.",
    notes: Object.freeze([
      "Shelf fungi add a new pale rim as they expand across fallen wood.",
      "Waxcaps shine in old grasslands where the soil has remained undisturbed.",
      "Many delicate caps last only a day before dissolving back into the leaf litter.",
    ]),
    coda: "Photographs and close observation are safer guides than guesswork; many lookalikes differ in important ways.",
    label: "Forest Mushroom",
    activities: Object.freeze(["Looking beneath the leaf litter", "Comparing caps after rain", "Walking the damp woodland", "Noting shapes on fallen wood"]),
  }),
  Object.freeze({
    id: "migrating-birds",
    title: "Birds Between Seasons",
    about: "migrating birds, seasonal coastlines, and the landmarks that guide long journeys",
    lede: "Twice each year, familiar fields and shorelines briefly fill with travelers moving between distant climates.",
    notes: Object.freeze([
      "Many small birds travel at night when the air is cooler and calmer.",
      "Mudflats become vital resting places where shorebirds can quickly rebuild their energy.",
      "Young birds combine inherited direction with landmarks learned along the way.",
    ]),
    coda: "A single feathered visitor can connect a local patch of water to places far beyond the horizon.",
    label: "Seasonal Bird",
    activities: Object.freeze(["Watching the headland", "Listening for evening wings", "Following birds between seasons", "Noting visitors on the mudflat"]),
  }),
  Object.freeze({
    id: "spice-drawer",
    title: "Notes from the Spice Drawer",
    about: "whole spices, toasted aromas, and the distinct character of seeds, bark, fruit, and roots",
    lede: "A small spice drawer is a cabinet of climates, preserving warm bark, dried fruit, seeds, roots, and flower buds.",
    notes: Object.freeze([
      "Green cardamom carries citrus and eucalyptus aromas inside a papery pod.",
      "Cumin becomes rounder and nuttier after a brief toast in a dry pan.",
      "Freshly grated nutmeg is sweeter and more floral than a jar left open for months.",
    ]),
    coda: "Grinding only what is needed keeps the brightest aromas close to the meal rather than inside the cupboard.",
    label: "Spice Drawer",
    activities: Object.freeze(["Comparing seeds and bark", "Opening a fragrant pod", "Tasting warm spices", "Sorting aromas by hand"]),
  }),
  Object.freeze({
    id: "old-doorways",
    title: "Doorways Worth Noticing",
    about: "old doorways, worn thresholds, and the architectural details that give a street its character",
    lede: "A doorway compresses a building's history into a small frame of stone, timber, metal, glass, and repeated touch.",
    notes: Object.freeze([
      "A polished brass plate records where generations of hands have pushed.",
      "Fanlights borrow daylight for narrow halls while preserving privacy below.",
      "Deep thresholds reveal walls built for weather, weight, and a different pace of construction.",
    ]),
    coda: "Looking at entrances turns an ordinary block into a gallery of proportion, material, and local habit.",
    label: "Old Doorway",
    activities: Object.freeze(["Studying worn thresholds", "Comparing fanlights and frames", "Walking a street of old doors", "Finding details in stone and brass"]),
  }),
  Object.freeze({
    id: "river-stones",
    title: "The Shape of River Stones",
    about: "river stones, moving water, and the patient rounding of rough mineral edges",
    lede: "Every rounded stone is a compact record of fracture, distance, current, and countless collisions beneath the water.",
    notes: Object.freeze([
      "Flat stones often begin as thin-bedded rock that splits along natural layers.",
      "Quartz survives long journeys and remains pale after softer minerals wear away.",
      "A dry pebble can look muted until water restores the contrast in its grains.",
    ]),
    coda: "Color catches the eye first, but shape and texture often tell the longer story of where a stone has traveled.",
    label: "River Stone",
    activities: Object.freeze(["Comparing water-worn shapes", "Reading color in wet stone", "Following pebbles downstream", "Studying grains by the river"]),
  }),
]);

const ABOUT_OPENERS = Object.freeze([
  (subject) => `Field notes on ${subject}.`,
  (subject) => `A compact notebook about ${subject}.`,
  (subject) => `Observations and small curiosities concerning ${subject}.`,
  (subject) => `An informal guide to ${subject}.`,
]);

const LABEL_SUFFIXES = Object.freeze(["Almanac", "Fieldbook", "Journal", "Notebook", "Studies", "Sketches"]);

const layouts = Object.freeze([
  (theme, about) =>
    `# ${theme.title}\n\n*${about}*\n\n${theme.lede}\n\n## Three things to notice\n\n` +
    theme.notes.map((note) => `- ${note}`).join("\n") + `\n\n${theme.coda}\n`,
  (theme, about) =>
    `# ${theme.title}\n\n> ${theme.lede}\n\n### A closer look\n\n` +
    theme.notes.map((note, index) => `${index + 1}. ${note}`).join("\n") +
    `\n\n### In brief\n\n${about} ${theme.coda}\n`,
  (theme, about) =>
    `# ${theme.title}\n\n${about}\n\n${theme.lede}\n\n| Lens | Observation |\n| --- | --- |\n` +
    theme.notes.map((note, index) => `| ${["Form", "Texture", "Character"][index]} | ${note} |`).join("\n") +
    `\n\n## Parting thought\n\n${theme.coda}\n`,
  (theme, about) =>
    `# ${theme.title}\n\n${theme.lede}\n\n---\n\n` +
    theme.notes.map((note, index) => `**${["First", "Then", "Finally"][index]}.** ${note}`).join("\n\n") +
    `\n\n---\n\n_${about}_\n\n${theme.coda}\n`,
  (theme, about) =>
    `# ${theme.title}\n\n## A compact portrait\n\n${theme.lede}\n\n` +
    theme.notes.map((note) => `- **Look closely:** ${note}`).join("\n") +
    `\n\n## Why it stays interesting\n\n${theme.coda}\n\n_${about}_\n`,
  (theme, about) =>
    `# ${theme.title}\n\n${theme.lede}\n\n### What catches the eye?\n\n${theme.notes[0]}\n\n` +
    `### What rewards patience?\n\n${theme.notes[1]} ${theme.notes[2]}\n\n### One last note\n\n${theme.coda}\n\n> ${about}\n`,
]);

const FORBIDDEN_PUBLIC_TERMS = /\b(?:action|actions|agent|automation|automated|backend|background|build|cron|deploy|dispatch|endpoint|github|heartbeat|job|pipeline|repository|repo|runner|runtime|schedule|scheduled|scheduler|script|server|source|task|template|worker|workflow)\b|hh3d|jarvis|kh[oô]i[ -]?l[oỗ]i|linh[ -]?sư|t[oô]ng m[oô]n/iu;
const URLISH = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|dev|app)\b)/iu;

function digestFor(workerId, attempt = 0) {
  if (typeof workerId !== "string" || workerId.trim().length === 0 || workerId.length > 120) {
    throw new TypeError("A bounded non-empty worker identity is required.");
  }
  const hash = createHash("sha256")
    .update("github-public-identity-v1-188\0", "utf8")
    .update(workerId.trim().toLowerCase(), "utf8");
  if (attempt > 0) hash.update(`\0retry:${attempt}`, "utf8");
  return hash.digest();
}

function pick(digest, offset, choices) {
  return choices[digest.readUInt32BE(offset) % choices.length];
}

function assertPublicCopy(identity) {
  const fields = [identity.readme, identity.aboutDescription, identity.workflowName, identity.jobName];
  if (fields.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Public identity contains an empty field.");
  if (identity.aboutDescription.length > 160) throw new Error("Public About description exceeds 160 characters.");
  if (identity.workflowName.length > 80 || identity.jobName.length > 100) throw new Error("Public display label is too long.");
  if (identity.readme.length < 300 || identity.readme.length > 4096) throw new Error("Public README is outside its size bounds.");
  if (fields.some((value) => FORBIDDEN_PUBLIC_TERMS.test(value) || URLISH.test(value))) throw new Error("Public identity contains operational or linked text.");
  if (fields.some((value) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))) throw new Error("Public identity contains control characters.");
  if (!/^[A-Za-z0-9 '&-]+$/.test(identity.workflowName) || !/^[A-Za-z0-9 '&-]+$/.test(identity.jobName)) {
    throw new Error("Public display label is not safe for quoted YAML.");
  }
}

function containsInternalIdentity(identity, workerId) {
  const needle = workerId.trim().toLowerCase();
  if (needle.length < 3) return false;
  return [identity.readme, identity.aboutDescription, identity.workflowName, identity.jobName]
    .some((value) => value.toLowerCase().includes(needle));
}

/**
 * Return a stable, unrelated public presentation without exposing the value used to select it.
 *
 * @param {string} workerId
 * @returns {{ themeId: string, layoutId: number, readme: string, aboutDescription: string, workflowName: string, jobName: string }}
 */
export function publicIdentityForWorker(workerId) {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const digest = digestFor(workerId, attempt);
    const theme = pick(digest, 0, THEMES);
    const aboutDescription = pick(digest, 4, ABOUT_OPENERS)(theme.about);
    const layoutId = digest.readUInt32BE(8) % layouts.length;
    const workflowName = `${theme.label} ${pick(digest, 12, LABEL_SUFFIXES)}`;
    const jobName = pick(digest, 16, theme.activities);
    const identity = {
      themeId: theme.id,
      layoutId,
      readme: layouts[layoutId](theme, aboutDescription),
      aboutDescription,
      workflowName,
      jobName,
    };
    assertPublicCopy(identity);
    if (!containsInternalIdentity(identity, workerId)) return Object.freeze(identity);
  }
  throw new Error("Could not select public copy distinct from the internal identity.");
}

export const PUBLIC_IDENTITY_THEME_COUNT = THEMES.length;
export const PUBLIC_IDENTITY_LAYOUT_COUNT = layouts.length;
