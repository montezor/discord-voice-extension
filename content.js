// Discord Voice Recorder - Content Script
(() => {
  'use strict';

  const MAX_RECORD_SECONDS = 60;
  const BUTTON_ID = 'dvr-voice-btn';

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let timerInterval = null;
  let isRecording = false;

  // ── Button injection ──────────────────────────────────────────────

  function createButton() {
    const container = document.createElement('div');
    container.className = 'dvr-container';
    container.id = BUTTON_ID;

    const btn = document.createElement('button');
    btn.className = 'dvr-record-btn';
    btn.setAttribute('aria-label', 'Record voice message');
    btn.textContent = '🎤';
    btn.addEventListener('click', handleClick);

    const timer = document.createElement('span');
    timer.className = 'dvr-timer';
    timer.textContent = '0s';

    container.appendChild(btn);
    container.appendChild(timer);
    return container;
  }

  function findButtonBar() {
    // Discord's message bar buttons area - look for the buttons container
    // next to the text input. The buttons (gift, GIF, sticker, emoji) live
    // inside a div with role="toolbar" or inside the form's button area.
    const selectors = [
      // The button bar right of the text area
      '[class*="buttons_"][class*="container_"]',
      '[class*="buttons-"]',
      // Fallback: the form area containing the chat input
      'form [class*="channelTextArea"] [class*="buttons"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Heuristic fallback: find the emoji button and go to its parent container
    const emojiBtn = document.querySelector('[aria-label="Select emoji"], [aria-label="Open GIF picker"], [aria-label="Open sticker picker"]');
    if (emojiBtn) {
      // Walk up to the buttons wrapper
      let parent = emojiBtn.parentElement;
      while (parent && !parent.querySelector('[aria-label="Select emoji"]')) {
        parent = parent.parentElement;
      }
      // The direct parent of all those buttons
      if (emojiBtn.parentElement) return emojiBtn.parentElement.parentElement || emojiBtn.parentElement;
    }

    return null;
  }

  function injectButton() {
    // Already injected
    if (document.getElementById(BUTTON_ID)) return;

    const bar = findButtonBar();
    if (!bar) return;

    const btn = createButton();
    // Insert as the first child so it appears before gift/GIF/sticker/emoji
    bar.insertBefore(btn, bar.firstChild);
  }

  // ── Recording logic ───────────────────────────────────────────────

  async function startRecording(btn, timer) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioChunks = [];
      // Prefer ogg/opus for Discord inline playback, fall back to webm
      let mimeType = 'audio/webm;codecs=opus';
      if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // Stop all tracks
        stream.getTracks().forEach(t => t.stop());

        const blob = new Blob(audioChunks, { type: mimeType });
        const timestamp = Date.now();
        // Use .ogg extension and type for Discord inline audio player
        const isOgg = mimeType.includes('ogg');
        const ext = isOgg ? 'ogg' : 'ogg'; // always .ogg for Discord compatibility
        const file = new File([blob], `voice-message-${timestamp}.${ext}`, {
          type: 'audio/ogg',
          lastModified: timestamp,
        });
        console.log('[DVR] Recorded with mimeType:', mimeType, 'file:', file.name, 'size:', file.size);

        uploadFile(file);
        resetUI(btn, timer);
      };

      mediaRecorder.start(250); // collect data every 250ms
      isRecording = true;
      recordingStartTime = Date.now();

      btn.classList.add('dvr-recording');
      btn.textContent = '⏹';
      timer.classList.add('dvr-visible');
      timer.textContent = '0s';

      timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        timer.textContent = `${elapsed}s`;

        if (elapsed >= MAX_RECORD_SECONDS) {
          stopRecording(btn, timer);
        }
      }, 500);

    } catch (err) {
      console.error('[DVR] Microphone access denied or error:', err);
    }
  }

  function stopRecording(btn, timer) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    clearInterval(timerInterval);
    isRecording = false;
  }

  function resetUI(btn, timer) {
    btn.classList.remove('dvr-recording');
    btn.textContent = '🎤';
    timer.classList.remove('dvr-visible');
    timer.textContent = '0s';
  }

  function handleClick() {
    const container = document.getElementById(BUTTON_ID);
    if (!container) return;

    const btn = container.querySelector('.dvr-record-btn');
    const timer = container.querySelector('.dvr-timer');

    if (!isRecording) {
      startRecording(btn, timer);
    } else {
      stopRecording(btn, timer);
    }
  }

  // ── File upload via drag-and-drop simulation ──────────────────────

  function uploadFile(file) {
    // Strategy 1: Find Discord's hidden file input and set files on it
    const fileInput = document.querySelector('form input[type="file"]');
    if (fileInput) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        // Dispatch change event so React picks it up
        const changeEvent = new Event('change', { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        console.log('[DVR] Uploaded via file input');
        return;
      } catch (e) {
        console.warn('[DVR] File input approach failed, trying drag-and-drop:', e);
      }
    }

    // Strategy 2: Drag-and-drop simulation on the chat area
    const dropTarget = document.querySelector('[class*="channelTextArea"]')
      || document.querySelector('[class*="chat_"]')
      || document.querySelector('main');

    if (!dropTarget) {
      console.error('[DVR] Could not find drop target');
      return;
    }

    const dt = new DataTransfer();
    dt.items.add(file);

    const commonProps = {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    };

    dropTarget.dispatchEvent(new DragEvent('dragenter', commonProps));
    dropTarget.dispatchEvent(new DragEvent('dragover', commonProps));
    dropTarget.dispatchEvent(new DragEvent('drop', commonProps));

    console.log('[DVR] Uploaded via drag-and-drop simulation');
  }

  // ── MutationObserver to maintain button across SPA navigation ─────

  function observe() {
    // Initial inject attempt
    injectButton();

    const observer = new MutationObserver(() => {
      // Re-inject if button was removed (SPA navigation)
      if (!document.getElementById(BUTTON_ID)) {
        injectButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ── Init ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    // Small delay to let Discord render its UI
    setTimeout(observe, 1500);
  }
})();
