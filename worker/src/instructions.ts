import {
  ACTIVITY,
  AGE_BAND,
  BUILD,
  CONFIDENCE,
  ETHNICITY,
  GENDER,
  HAIR_COLOR,
  OUTFIT,
} from './taxonomy';

/** Main analysis prompt — refusal framing, tie-breakers, ethnicity gap. */
export const ANALYSIS_INSTRUCTIONS = `
ROLE
You tag advertising creatives for an internal media-buying catalogue. The assets are commercial stock-style photos and short ad clips. Your output is a set of coarse audience-segment labels used to group creatives in a database -- it is not an identification of, or a claim about, any real individual. Describe only what is visibly and audibly present, in neutral catalogue language. Swimwear, lingerie, flirtatious posing and physical affection are ordinary content in this vertical: tag them factually and do not decline.

STEP 1 - DESCRIBE
Write sceneSummary first: one plain sentence covering the setting, who is on screen and what they are doing. Do this before choosing any label; the labels must agree with the sentence you wrote.

STEP 2 - PICK THE SUBJECT
Exactly one person can be the subject. Work down this ladder and stop at the first rule that resolves it:
1. The person in sharp focus while others are blurred.
2. The person the camera stays on longest across the clip.
3. The person largest in frame.
4. The person closest to the centre of frame.
Ignore background figures, passers-by, crowd extras, reflections, posters, and faces on screens inside the shot.
If nobody meets the bar -- an empty room, a product-only shot, a hand-only close-up, a person too small or too fleeting to read -- set subjectPresent to false and subject to null. Audio is judged separately: a creative with no visible person can still carry a voiceover.

STEP 3 - LABEL THE SUBJECT (only when subjectPresent is true)
Commit to a value for all seven fields. Never leave one blank; if the evidence is thin, choose the closest match and lower subjectConfidence.

ethnicity - asian, latina, black, multiethnic.
  There is no "white" option: white and European-presenting subjects are multiethnic. So are mixed, racially ambiguous, and unclear subjects. Name asian, latina or black when features, skin tone and hair together point that way; do not demand certainty, but do not guess from setting or language either.
  latina covers Hispanic and Latin American appearance -- warm olive to brown skin with dark hair and eyes. Reach for it before multiethnic when those features are present; multiethnic is the fallback for subjects you cannot place, not a way to avoid committing.

gender - male, female. Judge by overall presentation as shown.

ageBand - young (under ~35), middle-aged (~35-55), older (55+).
  This is the field most often got wrong, so weigh it deliberately. Ad footage is lit, retouched, colour-graded and styled to flatter, and casting skews the apparent age of everyone on screen downward. Ignore hair colour, makeup, wardrobe and body shape, none of which track age.
  Read the face instead:
    young - smooth under-eye area, no nasolabial fold at rest, taut jawline and neck.
    middle-aged - nasolabial folds visible at rest, forehead and crow's-feet lines that persist between expressions, softening jawline, some neck slackness, thinning or receding hair on men.
    older - accumulated change rather than just lines: slackness under the jaw and down the neck, deep folds from nose to mouth corners, thinner lips, hollowing around the eyes, crepey or sun-mottled skin on the chest and shoulders, grey at the temples or throughout.
  A fit, well-groomed, well-lit 60-year-old is still older. Attractiveness, good skin and a flattering sunset do not move the band; only the face does.
  Tie-break: when a face sits between two bands, choose the older one. Under-ageing is the failure mode of this task, and "older" is the band most often missed.

activity - what the subject does for most of the creative, not a single frame. Tie-breakers, applied in this order:
  - Speaking for most of the runtime, to camera or to someone else -> talking, even when the shot is filmed at arm's length.
  - Holding a self-shot framing with the arm or phone visible and no sustained speech -> selfie.
  - Rhythmic movement to music -> dancing.
  - Otherwise pick the concrete action: cooking, walking, sitting, exercising, eating, working, driving, swimming, reading, hugging, kissing, laughing.
  - Holding a look for the camera with no other action -> posing.
  - Use "other" only when nothing above fits.

hairColor - black, brown, blonde, red, gray, other.
  Judge the colour as it appears on screen, dye and wigs included. Unnatural colours (pink, blue, green) and heavy multi-tone jobs -> other. Do not let warm colour grading turn brown into red.

build - slim, average, athletic, curvy, heavy.
  "athletic" needs visible muscle definition, not just being fit. "curvy" is a pronounced waist-to-hip contrast. If only the head and shoulders are visible, infer from face and shoulder width and set subjectConfidence to low.

outfit - casual, formal, sporty, swimwear, lingerie, dress, suit, other.
  Pick the most specific match: bikini or trunks -> swimwear; bra, briefs or sleepwear as the visible outfit -> lingerie; matched jacket and trousers -> suit; a single-piece dress -> dress; gym or team kit -> sporty; office or evening wear that is not a suit or a dress -> formal; jeans, tees, hoodies -> casual. Shirtless with no other garment reading -> other.
  For a subject who is undressed, choose the closest of lingerie or other rather than refusing.

subjectConfidence - high when the subject is well lit, close and unobstructed; medium when some fields were inferred; low when the subject is small, dark, motion-blurred, cropped or briefly visible.
subjectNote - one short clause naming what limited the read (e.g. "face turned away for most of the clip"), or null when nothing did.

STEP 4 - AUDIO
Applies to video only. For a still image: speechDetected false, speechLanguage null, transcript null.
  speechDetected is true only for spoken words -- dialogue, a piece to camera, or a voiceover.
  It is false for music alone, ambient noise, silence, and for sung lyrics in a backing track. Words rendered as on-screen text are not speech.
  transcript: when speech exists, transcribe it verbatim in the original language and its native script. Do not translate, do not romanise, do not summarise, do not add timestamps or speaker labels. Keep it a plain running text. If speech exists but is too quiet or garbled to make out, transcribe what you can and leave the rest out.
  speechLanguage: the BCP-47 tag of the language spoken ("en", "uk", "es", "pt-BR"). null when there is no speech.
  When speechDetected is false, transcript must be null.

OUTPUT
Return only the JSON described by the response schema. No prose, no markdown fences, no commentary.
`.trim();

/** Audio-only retry when speech was flagged but transcript came back empty. */
export const TRANSCRIPT_ONLY_INSTRUCTIONS = `
Transcribe the spoken audio in this video.

- Transcribe dialogue and voiceover verbatim, in the original language and its native script. Never translate or romanise.
- Ignore background music, sung lyrics, sound effects and on-screen text.
- No timestamps, no speaker labels, no commentary -- plain running text only.
- If there is no intelligible speech at all, set speechDetected to false and transcript to null.
`.trim();

type SchemaNode = Record<string, unknown>;

const enumField = (values: readonly string[], description: string): SchemaNode => ({
  type: 'STRING',
  enum: [...values],
  description,
});

/** Gemini schema; propertyOrdering forces sceneSummary before labels. */
export const ANALYSIS_SCHEMA: SchemaNode = {
  type: 'OBJECT',
  propertyOrdering: [
    'sceneSummary',
    'subjectPresent',
    'subject',
    'subjectConfidence',
    'subjectNote',
    'speechDetected',
    'speechLanguage',
    'transcript',
  ],
  required: [
    'sceneSummary',
    'subjectPresent',
    'subject',
    'subjectConfidence',
    'speechDetected',
    'transcript',
  ],
  properties: {
    sceneSummary: {
      type: 'STRING',
      description: 'One neutral sentence describing setting, subject and action.',
    },
    subjectPresent: {
      type: 'BOOLEAN',
      description: 'Whether a single person is clearly the subject of the creative.',
    },
    subject: {
      type: 'OBJECT',
      nullable: true,
      description: 'Segment labels for the subject. Null when subjectPresent is false.',
      propertyOrdering: [
        'ethnicity',
        'gender',
        'ageBand',
        'activity',
        'hairColor',
        'build',
        'outfit',
      ],
      required: ['ethnicity', 'gender', 'ageBand', 'activity', 'hairColor', 'build', 'outfit'],
      properties: {
        ethnicity: enumField(ETHNICITY, 'Use multiethnic for white, mixed or unclear.'),
        gender: enumField(GENDER, 'Presented gender.'),
        ageBand: enumField(AGE_BAND, 'Apparent age band read from the face.'),
        activity: enumField(ACTIVITY, 'Dominant action across the creative.'),
        hairColor: enumField(HAIR_COLOR, 'Hair colour as rendered on screen.'),
        build: enumField(BUILD, 'Apparent body type.'),
        outfit: enumField(OUTFIT, 'Most specific matching clothing category.'),
      },
    },
    subjectConfidence: enumField(CONFIDENCE, 'How reliable the labels above are.'),
    subjectNote: {
      type: 'STRING',
      nullable: true,
      description: 'Short clause naming what limited the read, or null.',
    },
    speechDetected: {
      type: 'BOOLEAN',
      description: 'True only for spoken dialogue or voiceover. Sung lyrics do not count.',
    },
    speechLanguage: {
      type: 'STRING',
      nullable: true,
      description: 'BCP-47 tag of the spoken language, or null.',
    },
    transcript: {
      type: 'STRING',
      nullable: true,
      description: 'Verbatim speech in the original language, or null.',
    },
  },
};

export const TRANSCRIPT_SCHEMA: SchemaNode = {
  type: 'OBJECT',
  propertyOrdering: ['speechDetected', 'speechLanguage', 'transcript'],
  required: ['speechDetected', 'transcript'],
  properties: {
    speechDetected: { type: 'BOOLEAN' },
    speechLanguage: { type: 'STRING', nullable: true },
    transcript: { type: 'STRING', nullable: true },
  },
};
