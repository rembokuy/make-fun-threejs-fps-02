// The look plan, in one place. A dusk foundry yard: cold blue-grey steel, warm
// sand concrete, rust orange as the one accent, teal for the defenders. Every
// colour in the game is one of these names; the same names are the CSS custom
// properties in index.html. Nothing here copies another game's palette.
export const PALETTE = {
  canvas: '#10151c', // sky / background
  ground: '#4a5058', // yard concrete
  surface: '#2c343d', // wall steel
  dark: '#171d23', // shadowed steel
  hairline: '#4a545e', // trim, crates
  sand: '#8a7a5c', // sandbags, concrete blocks
  rust: '#c96a2e', // accent: attackers, site markers, hazard stripes
  teal: '#2e8f86', // defenders
  ink: '#e8e4d8', // light text, player tracers
  muted: '#9aa4ad', // dim text
  amber: '#e8a33d', // attackers' second accent, muzzle light
};

export function hex(name) {
  return PALETTE[name];
}
