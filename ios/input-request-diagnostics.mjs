// Observe only the existing element click in the failing search animation.
export function inputRequestTiming(method, path, filter = process.env.IOS_FILTER,
  write = body => console.log('[search element click]', body)) {
  if (filter !== 'guest search confirmation animates into and out of the iOS screen$'
    || method !== 'POST' || !/^\/session\/[^/]+\/element\/[^/]+\/click$/.test(path)) return () => {};
  const requestedUtc = new Date().toISOString();
  let reported = false;
  return status => {
    try {
      if (reported) return;
      reported = true;
      write(JSON.stringify({ requestedUtc, completedUtc: new Date().toISOString(), status }));
    } catch { /* Diagnostic output must never change the request result. */ }
  };
}
