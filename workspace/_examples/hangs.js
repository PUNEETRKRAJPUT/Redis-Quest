// A function that never finishes (a promise that never resolves). The run's timeoutMs ends the call
// with a TimeoutError; the child process is then exited by the runner.
export default async function () {
  await new Promise(() => {});
}
