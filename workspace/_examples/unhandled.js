// Starts a promise that rejects and nobody awaits. The child process must survive it, the call
// itself still succeeds, and the failure is written to the run's logs.
export default async function () {
  Promise.reject(new Error('nobody caught this'));
  return 'returned before the rejection was handled';
}
