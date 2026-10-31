// A module whose function throws. The runner must report the error (name, message, stack)
// for the call and stay healthy.
export default async function () {
  throw new TypeError('this learner function always throws');
}
