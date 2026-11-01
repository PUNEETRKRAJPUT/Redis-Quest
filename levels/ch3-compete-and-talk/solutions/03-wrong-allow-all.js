// Wrong: lets every request through, which is what the app does before you touch it. 15 of 15 are allowed and
// no ratelimit:<userId> hash is ever written.
export default async function allow() {
  return true;
}
