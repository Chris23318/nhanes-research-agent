const SECURITY_HEADERS={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'
};
function createRateLimiter(maxBuckets=10000){const buckets=new Map();return {check(key,scope,limit,windowMs,now=Date.now()){const id=`${String(key).slice(0,100)}:${scope}`,current=buckets.get(id);if(!current||now-current.startedAt>=windowMs){if(!current&&buckets.size>=maxBuckets)buckets.delete(buckets.keys().next().value);buckets.set(id,{startedAt:now,count:1});return {allowed:true,remaining:limit-1}}current.count+=1;const retryAfter=Math.max(1,Math.ceil((windowMs-(now-current.startedAt))/1000));return {allowed:current.count<=limit,remaining:Math.max(0,limit-current.count),retryAfter}}};}
module.exports={SECURITY_HEADERS,createRateLimiter};
