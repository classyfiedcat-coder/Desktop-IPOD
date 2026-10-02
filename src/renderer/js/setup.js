/** Spotify setup window. */

const $ = (id) => document.getElementById(id);
const api = window.ipod.spotify;

function setStatus(text, error = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function render(st) {
  $('connected').hidden = !st.connected;
  $('setup').hidden = !!st.connected;
  if (st.redirectUri) $('redirect').textContent = st.redirectUri;
  if (st.clientId && !$('client-id').value) $('client-id').value = st.clientId;
  if (st.user) $('account').textContent = `Signed in as ${st.user.name}.`;
  $('connect').disabled = !!st.pending;
  if (st.pending) setStatus('Waiting for you to approve in your browser…');
}

async function init() {
  render(await api.status());
  api.onChange(render);

  $('open-dashboard').addEventListener('click', () => window.ipod.system.openExternal('https://developer.spotify.com/dashboard'));
  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('redirect').textContent.trim());
    $('copy').textContent = 'Copied';
    setTimeout(() => ($('copy').textContent = 'Copy'), 1500);
  });
  $('connect').addEventListener('click', async () => {
    const id = $('client-id').value.trim();
    if (!id) {
      setStatus('Paste your Client ID first.', true);
      $('client-id').focus();
      return;
    }
    try {
      await api.setClientId(id);
    } catch (err) {
      setStatus(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
      return;
    }
    setStatus('Opening Spotify in your browser…');
    const res = await api.login();
    if (res.ok) setStatus('');
    else setStatus(res.error || 'Sign-in failed.', true);
    render(res.status);
  });
  $('client-id').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('connect').click();
  });
  $('done').addEventListener('click', () => api.closeSetup());
  $('logout').addEventListener('click', async () => render(await api.logout()));
}

init();
