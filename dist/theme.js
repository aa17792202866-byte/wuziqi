(() => {
 const key='gomoku-color-theme';
 const system=window.matchMedia('(prefers-color-scheme: dark)');
 let saved=null;
 try{const value=localStorage.getItem(key);if(value==='dark'||value==='light')saved=value}catch{}
 const preferred=()=>saved||(system.matches?'dark':'light');
 function apply(theme){
  const dark=theme==='dark';
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  const button=document.getElementById('theme-toggle');
  if(!button)return;
  const next=dark?'浅色':'深色';
  button.setAttribute('aria-label',`切换为${next}模式`);
  button.setAttribute('aria-pressed',String(dark));
  button.title=`切换为${next}模式`;
  button.querySelector('.theme-icon').textContent=dark?'☀':'☾';
  button.querySelector('.theme-label').textContent=next;
 }
 apply(preferred());
 document.addEventListener('DOMContentLoaded',()=>{
  apply(preferred());
  document.getElementById('theme-toggle')?.addEventListener('click',()=>{
   saved=document.documentElement.dataset.theme==='dark'?'light':'dark';
   try{localStorage.setItem(key,saved)}catch{}
   apply(saved);
  });
 });
 const followSystem=()=>{if(!saved)apply(preferred())};
 if(system.addEventListener)system.addEventListener('change',followSystem);else system.addListener(followSystem);
})();
