document.addEventListener('DOMContentLoaded', () => {
  const fileInput        = document.getElementById('file-input');
  const fileInputDiv     = document.querySelector('.file-input');
  const uploadBtn        = document.getElementById('upload-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar      = document.getElementById('progress-bar');
  const successPanel     = document.getElementById('successPanel');
  const cidDisplay       = document.getElementById('cidDisplay');
  const copyCidBtn       = document.getElementById('copyCidBtn');
  const copyConfirm      = document.getElementById('copyConfirm');
  const errorMessage     = document.getElementById('errorMessage');
  const errorText        = document.getElementById('errorText');

  // ── File input click ──────────────────────────────────────
  fileInputDiv.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      fileInputDiv.querySelector('p').textContent = `Selected: ${file.name}`;
    }
  });

  // ── Drag and drop ─────────────────────────────────────────
  fileInputDiv.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileInputDiv.classList.add('bg-blue-50');
  });

  fileInputDiv.addEventListener('dragleave', () => {
    fileInputDiv.classList.remove('bg-blue-50');
  });

  fileInputDiv.addEventListener('drop', (e) => {
    e.preventDefault();
    fileInputDiv.classList.remove('bg-blue-50');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      fileInputDiv.querySelector('p').textContent = `Selected: ${files[0].name}`;
    }
  });

  // ── Upload ────────────────────────────────────────────────
  uploadBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const file = fileInput.files[0];
    if (!file) { showError('Please select a file.'); return; }

    const token = localStorage.getItem('token');
    if (!token) { showError('Please login first.'); return; }

    // Reset UI
    successPanel.classList.add('hidden');
    errorMessage.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';

    // Animate progress while waiting for IPFS
    let fakeProgress = 0;
    const progressTimer = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + 4, 85);
      progressBar.style.width = fakeProgress + '%';
    }, 200);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      clearInterval(progressTimer);
      const data = await response.json();

      if (response.ok) {
        progressBar.style.width = '100%';
        showCID(data.cid);
      } else {
        progressBar.style.width = '0%';
        showError(data.error || 'Upload failed.');
      }
    } catch (error) {
      clearInterval(progressTimer);
      progressBar.style.width = '0%';
      showError('Upload failed. Please try again.');
    }
  });

  // ── Copy CID button ───────────────────────────────────────
  copyCidBtn.addEventListener('click', () => {
    const cid = cidDisplay.textContent;
    if (!cid || cid === '—') return;
    navigator.clipboard.writeText(cid).then(() => {
      copyConfirm.classList.remove('hidden');
      setTimeout(() => copyConfirm.classList.add('hidden'), 2000);
    }).catch(() => {
      const el = document.createElement('textarea');
      el.value = cid;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      copyConfirm.classList.remove('hidden');
      setTimeout(() => copyConfirm.classList.add('hidden'), 2000);
    });
  });

  // ── Helpers ───────────────────────────────────────────────
  function showCID(cid) {
    cidDisplay.textContent = cid;
    successPanel.classList.remove('hidden');
    errorMessage.classList.add('hidden');
  }

  function showError(text) {
    errorText.textContent = text;
    errorMessage.classList.remove('hidden');
    successPanel.classList.add('hidden');
  }
});
