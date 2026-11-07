import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import flowbiteReact from 'flowbite-react/plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(({command})=>{
 const plugins=[flowbiteReact(),react(),tailwindcss()];
 if(process.env.STUDIO_ANDROID_APP!=='true')plugins.push(VitePWA({registerType:'autoUpdate',selfDestroying:command==='serve',devOptions:{enabled:true},manifest:{name:'Astro Static Studio',short_name:'Astro Studio',lang:'fa',dir:'rtl',start_url:'/',display:'standalone',background_color:'#f5f3ed',theme_color:'#263c32',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},workbox:{navigateFallback:'/index.html',globPatterns:['**/*.{js,css,html,png,svg}']}}));
 return {plugins,server:{proxy:{'/api':'http://127.0.0.1:4322','/media':'http://127.0.0.1:4322'}}};
});
