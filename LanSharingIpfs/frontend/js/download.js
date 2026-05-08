document.addEventListener('DOMContentLoaded', () => {
  // ── DOM refs ──────────────────────────────────────────────
  const downloadForm      = document.getElementById('downloadForm');
  const cidInput          = document.getElementById('cid-input');
  const downloadBtn       = document.getElementById('download-btn');
  const registerForm      = document.getElementById('registerForm');
  const regCid            = document.getElementById('reg-cid');
  const regKey            = document.getElementById('reg-key');
  const regFilename       = document.getElementById('reg-filename');
  const registerBtn       = document.getElementById('register-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar       = document.getElementById('progress-bar');
  const progressText      = document.getElementById('progressText');
  const successMessage    = document.getElementById('successMessage');
  const errorMessage      = document.getElementById('errorMessage');
  const successText       = document.getElementById('successText');
  const errorText         = document.getElementById('errorText');

  // ── Tab switching (also called from HTML) ─────────────────
  window.switchTab = function(tab) {
    document.getElementById('panel-download').classList.toggle('active', tab === 'download');
    document.getElementById('panel-register').classList.toggle('active', tab === 'register');
    document.getElementById('tab-download').classList.toggle('active', tab === 'download');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    hideMessages();
  };

  // ── Pre-fill CID from URL param (?cid=Qm...) ─────────────
  const urlParams = new URLSearchParams(window.location.search);
  const paramCid  = urlParams.get('cid');
  if (paramCid) {
    cidInput.value = paramCid.trim();
  }

  // ── Helpers ───────────────────────────────────────────────
  function showSuccess(msg) {
    successText.textContent = msg;
    successMessage.classList.remove('hidden');
    errorMessage.classList.add('hidden');
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorMessage.classList.remove('hidden');
    successMessage.classList.add('hidden');
  }

  function hideMessages() {
    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  // ── DOWNLOAD ──────────────────────────────────────────────
  async function handleDownload(e) {
    if (e) e.preventDefault();

    const cid = cidInput.value.trim();
    if (!cid) { showError('Please enter a CID.'); return; }

    const token = getToken();
    if (!token) { showError('Please login first.'); window.location.href = 'login.html'; return; }

    hideMessages();
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '20%';
    progressText.textContent = 'Connecting to server...';
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading...';

    try {
      progressBar.style.width = '50%';
      progressText.textContent = 'Fetching & decrypting file...';

      const response = await fetch(`/api/files/download/${encodeURIComponent(cid)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      progressBar.style.width = '85%';
      progressText.textContent = 'Processing file...';

      if (response.ok) {
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `file-${cid.slice(-8)}`;
        if (contentDisposition) {
          const m = contentDisposition.match(/filename="?(.+?)"?$/);
          if (m) filename = m[1];
        }

        const blob = await response.blob();
        const url  = window.URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 200);

        progressBar.style.width = '100%';
        progressText.textContent = 'Download complete!';
        setTimeout(() => {
          progressContainer.classList.add('hidden');
          showSuccess(`✅ "${filename}" downloaded successfully!`);
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download File';
        }, 800);

      } else {
        const data = await response.json().catch(() => ({}));
        progressContainer.classList.add('hidden');

        // ── Smart error with hint ──────────────────────────
        let msg = data.message || 'Download failed.';
        if (response.status === 404) {
          msg = '❌ File not found in this device\'s database. '
              + 'If a peer shared this CID via chat it should auto-register — '
              + 'otherwise go to the "Register CID" tab and enter the CID + key manually.';
        } else if (response.status === 500 && msg.includes('IPFS')) {
          msg = '⚠️ Could not reach IPFS network. Make sure you are connected to the internet or IPFS daemon is running. Error: ' + msg;
        }
        showError(msg);
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download File';
      }
    } catch (err) {
      console.error('Download error:', err);
      progressContainer.classList.add('hidden');
      showError('Network error — make sure the server is running. ' + err.message);
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download File';
    }
  }

  downloadForm.addEventListener('submit', handleDownload);

  // ── REGISTER CID ──────────────────────────────────────────
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cid      = regCid.value.trim();
    const key      = regKey.value.trim();
    const filename = regFilename.value.trim();

    if (!cid || !key || !filename) { showError('All three fields are required.'); return; }

    const token = getToken();
    if (!token) { showError('Please login first.'); window.location.href = 'login.html'; return; }

    hideMessages();
    registerBtn.disabled = true;
    registerBtn.textContent = 'Registering...';

    try {
      const res  = await fetch('/api/files/register-cid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ cid, key, filename, size: 0 })
      });
      const data = await res.json();

      if (res.ok) {
        showSuccess(`✅ CID registered! Now switch to the Download tab and paste: ${cid}`);
        // Pre-fill download tab
        cidInput.value = cid;
      } else {
        showError(data.error || data.message || 'Registration failed.');
      }
    } catch (err) {
      showError('Network error: ' + err.message);
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = 'Register CID';
    }
  });
});
