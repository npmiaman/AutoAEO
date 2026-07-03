// Pixel-pigeon sprite data. One char per cell → PIGEON_PALETTE colour (space = transparent).
// Traced by downsampling source.jpg to its native 16px grid → a 29×23 sprite.
export const PIGEON_PALETTE = {
  a: "#010002",
  b: "#12181b",
  c: "#394644",
  d: "#858177",
  e: "#1e2b2d",
  f: "#605f5a",
  g: "#953733", // red eye
  h: "#697c71",
  i: "#cecac1",
  j: "#a39b92",
  k: "#b3aaa1",
  l: "#886070",
  m: "#3e2c33",
  n: "#673135",
  o: "#7e3940",
};

export const PIGEON_ART = [
  "                     aaab",
  "                    cddddc",
  "                  eaddddde",
  "                  fdddgdde",
  "                bfhdddddicb",
  "              aejj hhdddfea",
  "            efjjjkj      ch",
  "           fjjkkkkk    hhflm",
  "          cjjkkkkkkkhffllllla",
  "         mjjjkkkkkkkdllllllla",
  "        mcdjjkkkkkkkjllllllle",
  "       mfccjjkkkkkkkkbdddddm",
  "      ccffcdjkkkkkkkjbdddddc",
  "      mccdcfjjkkkkkkfhddddd",
  "     abjccjccjjkkkkkcddddda",
  "   cembjfcffcdjjjjfmhdddfc",
  "  bmmmmajfcfmhjjjachdddff",
  "  mmmmeeehcfemffeffhhcccc",
  "emmmmac  aacffffffffm n",
  "eeebb      cbfffffebcngn",
  "                  ngnnnnnn",
  "                 fooonoh",
  "                 ffffff",
];

// Animation anchors
export const PIGEON_EYE = [22, 3]; // eye cell (for the blink)
export const PIGEON_HEAD = "d"; // head colour the eye blinks to
