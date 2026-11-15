// Tags and topics. Pure functions, no DOM: tested in Node.
//
// A "tag" is a hashtag from a post's caption. A "topic" is a broad subject
// that groups many tags (drums, drummer, drumcover -> Drums). Topics are a
// fixed, hand-written taxonomy matched by keyword, so nothing is sent to any
// service to classify anything.

// Pattern syntax: "=word" matches a tag exactly, anything else matches as a
// substring ("drum" matches "drummer" and "worshipdrummer").
export const TOPICS = [
  { id: 'comedy', label: 'Comedy and memes', match: ['funny', 'meme', 'comedy', 'humor', 'humour', 'skit', 'sketch', 'joke', '=lol', '=lmao', 'relatable', 'satire', 'parody'] },
  { id: 'code', label: 'Code and tech', match: ['coding', 'coder', 'program', 'developer', '=dev', 'webdev', 'devops', 'devlife', 'devhumor', 'javascript', 'python', '=java', '=css', '=html', 'linux', 'software', 'computerscience', '=tech', 'technology', 'android', '=windows', 'stackoverflow', '=ai', 'reactjs', 'nodejs', 'instacode', '=code', 'opensource', 'cybersecurity', '=computer'] },
  { id: 'drums', label: 'Drums', match: ['drum', 'bateria', 'cymbal', 'vicfirth', 'percussion'] },
  { id: 'music', label: 'Music', match: ['music', 'guitar', 'piano', 'singing', 'singer', 'song', '=band', '=cover', '=rock', 'fender', 'kpop', 'concert', '=bass', 'bassist', 'vocal', 'acoustic', '=jazz', 'orchestra'] },
  { id: 'faith', label: 'Faith', match: ['christian', 'worship', 'church', 'jesus', 'bible', '=god', 'godis', 'gospel', '=faith', 'prayer', 'veggietales', 'sermon', 'scripture', 'devotional'] },
  { id: 'cars', label: 'Cars and racing', match: ['=car', '=cars', 'carsof', 'carmeme', 'carculture', '=f1', 'f1meme', 'formula1', 'jdm', 'racing', 'motorsport', 'supra', '=honda', '=toyota', '=drift', '=stance', 'verstappen', 'piastri', 'nascar', 'porsche', '=bmw', 'automotive', 'mcqueen'] },
  { id: 'screen', label: 'TV and film', match: ['netflix', 'newgirl', 'nickmiller', 'jessicaday', '=schmidt', 'theoffice', 'starwars', '=andor', 'marvel', 'spiderman', 'batman', 'disney', 'movie', '=film', 'films', 'anime', 'transformers', 'hutcherson', 'sitcom', 'tvshow', 'cinema', 'pixar', 'demonhunters'] },
  { id: 'school', label: 'School and science', match: ['college', 'university', '=uni', 'student', '=school', 'math', 'physics', 'chemistry', 'biology', 'science', 'engineer', '=nasa', '=space', 'universe', 'research', 'education', 'intern', 'freshers', 'astronomy'] },
  { id: 'play', label: 'LEGO and games', match: ['lego', '=afol', 'gaming', 'gamer', 'nintendo', '=wii', 'minecraft', 'xbox', 'playstation', 'videogame', 'boardgame', 'pokemon', 'zelda'] },
  { id: 'family', label: 'Family', match: ['=dad', 'dadlife', 'dadjoke', '=mom', 'momlife', 'toddler', '=family', 'parent', '=baby', '=kids', 'siblings', 'marriage', 'husband', 'wife'] },
  { id: 'aviation', label: 'Aviation', match: ['aviation', 'pilot', 'avgeek', 'airplane', '=plane', 'aircraft', 'airline', 'boeing', 'airbus'] },
  { id: 'food', label: 'Food', match: ['food', 'recipe', 'cooking', 'baking', '=chef', 'dinner', 'dessert', 'coffee', 'pizza', 'mealprep'] },
  { id: 'fitness', label: 'Fitness and sport', match: ['fitness', '=gym', 'gymlife', 'workout', 'running', 'football', 'soccer', 'basketball', 'hockey', '=nba', '=nfl', '=nhl', 'baseball', '=golf', 'tennis', 'climbing', 'cycling'] },
  { id: 'travel', label: 'Travel and outdoors', match: ['travel', 'wanderlust', 'vacation', 'roadtrip', '=nature', 'hiking', 'camping', 'mountain', 'outdoors', '=canada', '=alberta', 'landscape'] },
  { id: 'animals', label: 'Animals', match: ['=dog', 'dogsof', 'doglife', 'puppy', '=cat', 'catsof', 'kitten', '=pets', '=pet', 'animal', 'wildlife'] },
  { id: 'make', label: 'Art and making', match: ['=art', 'artist', 'artwork', 'drawing', 'painting', 'animation', '=design', 'designer', 'webdesign', '=ui', '=ux', '=diy', 'woodworking', '3dprint', 'photography', 'crafts'] },
  { id: 'work', label: 'Work and money', match: ['career', '=job', '=jobs', 'finance', 'invest', 'startup', 'business', 'entrepreneur', 'productivity', 'motivation', 'corporate', 'workfromhome'] },
];

export const UNSORTED = 'unsorted';

const compiled = TOPICS.map((topic) => ({
  id: topic.id,
  exact: new Set(topic.match.filter((m) => m.startsWith('=')).map((m) => m.slice(1))),
  stems: topic.match.filter((m) => !m.startsWith('=')),
}));

const topicById = new Map(TOPICS.map((topic) => [topic.id, topic]));
export const topicLabel = (id) => (id === UNSORTED ? 'Everything else' : topicById.get(id)?.label || id);

// Reach-bait hashtags that say nothing about the subject.
const NOISE_EXACT = new Set(['reel', 'edit', 'follow', 'like', 'share', 'trend', 'love', 'life', 'fun', 'instadaily', 'explorepage', 'fy', 'xyzbca', 'blowthisup']);
const NOISE_STEMS = ['fyp', 'viral', 'explore', 'trending', 'foryou', 'reels', 'instagram', 'instagood', 'tiktok', 'followfor', 'likefor'];

export function isNoiseTag(tag) {
  return NOISE_EXACT.has(tag) || NOISE_STEMS.some((stem) => tag.includes(stem));
}

const TAG_RE = /#([\p{L}\p{N}_]+)/gu;

// "Shaving cream #Prank #fyp" -> ['prank', 'fyp']
export function extractTags(caption) {
  const out = [];
  const seen = new Set();
  for (const match of String(caption || '').matchAll(TAG_RE)) {
    const tag = match[1].toLowerCase();
    if (tag.length > 40 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function topicMatches(topic, word) {
  return topic.exact.has(word) || topic.stems.some((stem) => word.includes(stem));
}

// Topic ids for one item. Tags decide; a caption with no hashtags falls back
// to its plain words so untagged posts are not all left unsorted.
export function topicsFor(tags, caption = '') {
  let words = tags.filter((tag) => !isNoiseTag(tag));
  if (words.length === 0 && caption) {
    words = caption.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  }
  const out = [];
  for (const topic of compiled) {
    if (words.some((word) => topicMatches(topic, word))) out.push(topic.id);
  }
  return out;
}
