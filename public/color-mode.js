// Runs before the first paint, so a stored dark mode never flashes light. hooks/useColorMode.ts uses the same key.
try {
  if (localStorage.getItem('tavio-dark-mode') === 'true') document.documentElement.classList.add('dark');
} catch {
  // No stored choice to read: stay light.
}
