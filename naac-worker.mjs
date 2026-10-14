/* Dedicated public report deployment. Only ./naac is published as website assets. */
import { handleNaacRequest } from './naac-api.js';
import { createD1NaacStore } from './naac-store.mjs';

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/naac/')){
      let store=null;
      try {if(env.NAAC_DB)store=createD1NaacStore(env.NAAC_DB);}catch{}
      return handleNaacRequest(request,env,{store,client:request.headers.get('CF-Connecting-IP')||'unknown'});
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not supported',{status:405});
    if(!env.ASSETS)return new Response('Public report assets are unavailable',{status:503});
    return env.ASSETS.fetch(request);
  }
};
