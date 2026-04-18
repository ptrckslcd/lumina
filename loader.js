// loader.js

(function() {
  const minLoadTime = 3650;
  const startTime = Date.now();

  window.addEventListener('load', () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, minLoadTime - elapsed);

    setTimeout(() => {
      const loader = document.getElementById('lumina-loader');
      if (loader) {
        loader.classList.add('hidden');
        
        // After fade transition (0.6s), remove from DOM and start app logic
        setTimeout(() => {
          loader.remove();
          
          // Dispatch custom event to notify app.js that all assets are loaded and ready
          window.dispatchEvent(new Event('lumina-loader-complete'));
          
        }, 600);
      } else {
        // Fallback if no loader element found
        window.dispatchEvent(new Event('lumina-loader-complete'));
      }
    }, remaining);
  });
})();
