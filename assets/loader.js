(()=>{
  const decode=(b64)=>decodeURIComponent(escape(atob(b64)));
  fetch('/assets/app.bundle.json',{cache:'no-store'})
    .then((r)=>r.json())
    .then((bundle)=>{
      const st=document.createElement('style');
      st.textContent=decode(bundle.c);
      document.head.appendChild(st);
      (bundle.j||[]).forEach((chunk)=>{
        (0, Function)(decode(chunk))();
      });
    })
    .catch((err)=>{ console.error('App bundle load failed', err); });
})();
