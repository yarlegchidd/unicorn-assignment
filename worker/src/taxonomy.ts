/** Controlled vocabulary shared by the Gemini schema, normaliser, and API. */

export const ETHNICITY = ['asian', 'latina', 'black', 'multiethnic'] as const;
export const GENDER = ['male', 'female'] as const;
export const AGE_BAND = ['young', 'middle-aged', 'older'] as const;
export const ACTIVITY = [
  'posing',
  'dancing',
  'cooking',
  'talking',
  'walking',
  'sitting',
  'exercising',
  'selfie',
  'eating',
  'working',
  'driving',
  'swimming',
  'reading',
  'hugging',
  'kissing',
  'laughing',
  'other',
] as const;
export const HAIR_COLOR = ['black', 'brown', 'blonde', 'red', 'gray', 'other'] as const;
export const BUILD = ['slim', 'average', 'athletic', 'curvy', 'heavy'] as const;
export const OUTFIT = [
  'casual',
  'formal',
  'sporty',
  'swimwear',
  'lingerie',
  'dress',
  'suit',
  'other',
] as const;
export const CONFIDENCE = ['high', 'medium', 'low'] as const;

export type Ethnicity = (typeof ETHNICITY)[number];
export type Gender = (typeof GENDER)[number];
export type AgeBand = (typeof AGE_BAND)[number];
export type Activity = (typeof ACTIVITY)[number];
export type HairColor = (typeof HAIR_COLOR)[number];
export type Build = (typeof BUILD)[number];
export type Outfit = (typeof OUTFIT)[number];
export type Confidence = (typeof CONFIDENCE)[number];

/** Null over invented defaults when a field is out of vocabulary. */
export interface SubjectAttributes {
  ethnicity: Ethnicity | null;
  gender: Gender | null;
  ageBand: AgeBand | null;
  activity: Activity | null;
  hairColor: HairColor | null;
  build: Build | null;
  outfit: Outfit | null;
}

export const ATTRIBUTE_FIELDS = [
  'ethnicity',
  'gender',
  'ageBand',
  'activity',
  'hairColor',
  'build',
  'outfit',
] as const satisfies readonly (keyof SubjectAttributes)[];

export const ATTRIBUTE_VOCABULARY = {
  ethnicity: ETHNICITY,
  gender: GENDER,
  ageBand: AGE_BAND,
  activity: ACTIVITY,
  hairColor: HAIR_COLOR,
  build: BUILD,
  outfit: OUTFIT,
} as const;
