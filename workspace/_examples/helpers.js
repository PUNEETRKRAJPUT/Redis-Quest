// Named exports are allowed for helpers. /load lists them next to `default`.
export function double(n) {
  return n * 2;
}

export default async function (deps, n = 21) {
  return double(n);
}
