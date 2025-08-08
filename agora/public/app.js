// Basic SPA routing and Agora join flow

const homeView = document.getElementById('home-view');
const roomView = document.getElementById('room-view');

const createRoomBtn = document.getElementById('create-room-btn');
const shareSection = document.getElementById('share-section');
const roomLinkInput = document.getElementById('room-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const roomIdInput = document.getElementById('room-id-input');
const goRoomBtn = document.getElementById('go-room-btn');

const roomTitle = document.getElementById('room-title');
const roomLink2 = document.getElementById('room-link-2');
const copyLinkBtn2 = document.getElementById('copy-link-btn-2');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const statusEl = document.getElementById('status');

const mediaControls = document.getElementById('media-controls');
const toggleCameraBtn = document.getElementById('toggle-camera-btn');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const requestPermissionsBtn = document.getElementById('request-permissions-btn');

const localPlayer = document.getElementById('local-player');
const remotePlayer = document.getElementById('remote-player');

let client;
let localTrack;
let localAudioTrack;
let localVideoTrack;
let remoteUidToPlayer = {};
let joined = false;
let currentRoomId = null;
let currentUid = null;
let cameraEnabled = true;
let micEnabled = true;

function generateRoomId() {
  const base = 'care-';
  const rand = Math.random().toString(36).slice(2, 8);
  return base + rand;
}

function buildRoomUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

async function ensureAgoraSDKLoaded() {
  if (window.AgoraRTC) return window.AgoraRTC;
  // Try official fallback CDN if primary failed/blocked
  try {
    await loadScript('https://download.agora.io/sdk/release/AgoraRTC_N-4.20.2.js');
  } catch (_e) {
    // ignore and check again below
  }
  if (window.AgoraRTC) return window.AgoraRTC;
  throw new Error('Agora SDK failed to load. Check your internet/cdn access.');
}

// Check if mediaDevices is supported and add fallback for older browsers
function checkMediaDevicesSupport() {
  console.log('Browser info:', navigator.userAgent);
  console.log('Current URL:', window.location.href);
  console.log('Protocol:', window.location.protocol);
  console.log('Hostname:', window.location.hostname);
  console.log('MediaDevices available:', !!navigator.mediaDevices);
  console.log('getUserMedia available:', !!navigator.mediaDevices?.getUserMedia);
  console.log('webkitGetUserMedia available:', !!navigator.webkitGetUserMedia);
  console.log('mozGetUserMedia available:', !!navigator.mozGetUserMedia);
  console.log('msGetUserMedia available:', !!navigator.msGetUserMedia);
  
  // Check if HTTPS is required
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isSecure = window.location.protocol === 'https:';
  const isEdge = navigator.userAgent.includes('Edg');
  
  if (!isLocalhost && !isSecure) {
    console.log('⚠️ WARNING: HTTPS is required for camera/microphone access when not using localhost');
    console.log('Current protocol:', window.location.protocol);
    console.log('Current hostname:', window.location.hostname);
    
    if (isEdge) {
      console.log('⚠️ EDGE SPECIFIC: Microsoft Edge requires HTTPS for camera/microphone access when using IP addresses');
      console.log('💡 SOLUTION: Use localhost instead of IP address, or enable HTTPS');
    }
  }
  
  // Create mediaDevices if it doesn't exist
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
  }
  
  // Add getUserMedia to mediaDevices if it doesn't exist
  if (!navigator.mediaDevices.getUserMedia) {
    // Try to get the old getUserMedia function
    const oldGetUserMedia = navigator.getUserMedia || 
                           navigator.webkitGetUserMedia || 
                           navigator.mozGetUserMedia || 
                           navigator.msGetUserMedia;
    
    if (oldGetUserMedia) {
      // Create a wrapper function
      navigator.mediaDevices.getUserMedia = function(constraints) {
        return new Promise(function(resolve, reject) {
          oldGetUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
      console.log('✅ Added getUserMedia fallback');
    } else {
      console.log('❌ No getUserMedia implementation found');
    }
  }
  
  // Test if getUserMedia is working
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      console.log('✅ getUserMedia is available and should work');
    } else {
      console.log('❌ getUserMedia is not available');
    }
  } catch (error) {
    console.log('❌ Error testing getUserMedia:', error);
  }
  
  // Additional debugging
  console.log('Final getUserMedia check:', typeof navigator.mediaDevices.getUserMedia);
  console.log('navigator.getUserMedia:', typeof navigator.getUserMedia);
  console.log('navigator.webkitGetUserMedia:', typeof navigator.webkitGetUserMedia);
}

function route() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  console.log('Route function - room parameter:', room);
  if (room) {
    currentRoomId = room;
    console.log('Setting currentRoomId to:', currentRoomId);
    homeView.classList.add('hidden');
    roomView.classList.remove('hidden');
    roomTitle.textContent = `Room: ${room}`;
    const link = buildRoomUrl(room);
    roomLink2.value = link;
  } else {
    roomView.classList.add('hidden');
    homeView.classList.remove('hidden');
  }
}

function getApiBaseUrl() {
  if (window.location.protocol === 'file:') {
    return 'http://localhost:3000';
  }
  // If using IP address, return the current origin
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return window.location.origin;
  }
  return '';
}

async function fetchToken(channelName, uid) {
  const apiBase = getApiBaseUrl();
  let res;
  try {
    res = await fetch(`${apiBase}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName, uid })
    });
  } catch (err) {
    throw new Error('Network error: unable to reach token endpoint');
  }
  if (!res.ok) {
    try {
      const errBody = await res.json();
      throw new Error(errBody?.error || 'Failed to fetch token');
    } catch (_e) {
      throw new Error('Failed to fetch token');
    }
  }
  return res.json();
}

async function joinRoom() {
  if (!currentRoomId || joined) return;
  statusEl.textContent = 'Joining...';
  joinBtn.disabled = true;
  try {
    // Use just the room ID as channel name, not the full URL
    const channelName = currentRoomId;
    console.log('Channel name being used:', channelName);
    const { token, uid, appId } = await fetchToken(channelName);
    currentUid = uid;

    const Agora = await ensureAgoraSDKLoaded();
    client = Agora.createClient({ mode: 'rtc', codec: 'vp8' });

    client.on('user-published', async (user, mediaType) => {
      console.log('Remote user published:', user.uid, mediaType);
      await client.subscribe(user, mediaType);
      if (mediaType === 'video') {
        console.log('Setting up remote video for user:', user.uid);
        const remoteContainer = document.createElement('div');
        remoteContainer.id = `remote-${user.uid}`;
        remoteContainer.style.width = '100%';
        remoteContainer.style.height = '100%';
        remotePlayer.innerHTML = '';
        remotePlayer.appendChild(remoteContainer);
        
        if (user.videoTrack) {
          user.videoTrack.play(remoteContainer);
          console.log('Remote video playing for user:', user.uid);
        } else {
          console.log('No video track for user:', user.uid);
        }
      }
      if (mediaType === 'audio') {
        if (user.audioTrack) {
          user.audioTrack.play();
          console.log('Remote audio playing for user:', user.uid);
        } else {
          console.log('No audio track for user:', user.uid);
        }
      }
    });

    client.on('user-joined', (user) => {
      console.log('User joined:', user.uid);
    });

    client.on('user-unpublished', (user) => {
      console.log('User unpublished:', user.uid);
      const el = document.getElementById(`remote-${user.uid}`);
      if (el) el.remove();
    });

    await client.join(appId, channelName, token, uid);

    try {
      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera/microphone access is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.');
      }
      
      // Try to get camera and mic permissions first
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      localTrack = await Agora.createMicrophoneAndCameraTracks();
      localAudioTrack = localTrack[0]; // audio track is index 0
      localVideoTrack = localTrack[1]; // video track is index 1
      
      const localContainer = document.createElement('div');
      localContainer.id = 'local-player-inner';
      localContainer.style.width = '100%';
      localContainer.style.height = '100%';
      localPlayer.innerHTML = '';
      localPlayer.appendChild(localContainer);
      localVideoTrack.play(localContainer);
      
      await client.publish(localTrack);
      console.log('Published local tracks (video + audio)');
      statusEl.textContent = 'Joined';
      
      // Show media controls
      mediaControls.classList.remove('hidden');
      toggleCameraBtn.style.display = 'inline-block';
      toggleMicBtn.style.display = 'inline-block';
    } catch (trackError) {
      console.log('Camera/mic access failed, trying audio only:', trackError.message);
      
      // Try to publish at least audio
      try {
        localAudioTrack = await Agora.createMicrophoneAudioTrack();
        await client.publish(localAudioTrack);
        console.log('Published local audio track only');
        statusEl.textContent = 'Joined (audio only)';
        
        // Show only mic control
        mediaControls.classList.remove('hidden');
        toggleCameraBtn.style.display = 'none';
        toggleMicBtn.style.display = 'inline-block';
      } catch (audioError) {
        console.log('Audio also failed:', audioError.message);
        statusEl.textContent = 'Joined (view only)';
        
        // Show permission request button for view only
        mediaControls.classList.remove('hidden');
        toggleCameraBtn.style.display = 'none';
        toggleMicBtn.style.display = 'none';
        requestPermissionsBtn.style.display = 'inline-block';
        
        // Add mobile-specific instructions
        if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
          statusEl.textContent = 'Joined (view only). Click "Enable Camera/Mic" and allow permissions when prompted.';
        }
      }
    }
    joined = true;
    leaveBtn.classList.remove('hidden');
    joinBtn.classList.add('hidden');
      } catch (e) {
      console.error(e);
      if (e.message.includes('not implemented')) {
        const isEdge = navigator.userAgent.includes('Edg');
        if (isEdge && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          statusEl.textContent = 'Microsoft Edge requires HTTPS for camera/microphone access when using IP addresses. Please use localhost instead.';
        } else {
          statusEl.textContent = 'Your browser does not support camera/microphone access. Please use Chrome, Firefox, Safari, or Edge.';
        }
      } else {
        statusEl.textContent = e?.message || 'Failed to join';
      }
      joinBtn.disabled = false;
    }
}

async function toggleCamera() {
  if (!localVideoTrack) return;
  
  if (cameraEnabled) {
    await localVideoTrack.setEnabled(false);
    toggleCameraBtn.textContent = 'Camera On';
    toggleCameraBtn.style.background = '#ff5d5d';
    cameraEnabled = false;
  } else {
    await localVideoTrack.setEnabled(true);
    toggleCameraBtn.textContent = 'Camera Off';
    toggleCameraBtn.style.background = '#5b8cfe';
    cameraEnabled = true;
  }
}

async function toggleMic() {
  if (!localAudioTrack) return;
  
  if (micEnabled) {
    await localAudioTrack.setEnabled(false);
    toggleMicBtn.textContent = 'Mic On';
    toggleMicBtn.style.background = '#ff5d5d';
    micEnabled = false;
  } else {
    await localAudioTrack.setEnabled(true);
    toggleMicBtn.textContent = 'Mic Off';
    toggleMicBtn.style.background = '#5b8cfe';
    micEnabled = true;
  }
}

async function requestPermissions() {
  try {
    statusEl.textContent = 'Requesting permissions...';
    
    // Check if mediaDevices is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera/microphone access is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.');
    }
    
    // Request camera and mic permissions
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    
    // Stop the test stream
    stream.getTracks().forEach(track => track.stop());
    
    // Make sure Agora SDK is loaded
    const Agora = await ensureAgoraSDKLoaded();
    
    // Now try to create Agora tracks
    localTrack = await Agora.createMicrophoneAndCameraTracks();
    localAudioTrack = localTrack[0];
    localVideoTrack = localTrack[1];
    
    // Publish the tracks
    await client.publish(localTrack);
    
    // Show local video
    const localContainer = document.createElement('div');
    localContainer.id = 'local-player-inner';
    localContainer.style.width = '100%';
    localContainer.style.height = '100%';
    localPlayer.innerHTML = '';
    localPlayer.appendChild(localContainer);
    localVideoTrack.play(localContainer);
    
    // Update UI
    statusEl.textContent = 'Joined';
    requestPermissionsBtn.style.display = 'none';
    toggleCameraBtn.style.display = 'inline-block';
    toggleMicBtn.style.display = 'inline-block';
    
    console.log('Successfully enabled camera and mic after permission request');
  } catch (error) {
    console.error('Permission request failed:', error);
    
    if (error.name === 'NotAllowedError') {
      statusEl.textContent = 'Permission denied. Please allow camera/mic access in your browser settings and try again.';
    } else if (error.name === 'NotFoundError') {
      statusEl.textContent = 'No camera/microphone found. Please check your device.';
    } else if (error.name === 'NotReadableError') {
      statusEl.textContent = 'Camera/microphone is already in use by another application.';
    } else if (error.message.includes('not implemented')) {
      const isEdge = navigator.userAgent.includes('Edg');
      if (isEdge && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        statusEl.textContent = 'Microsoft Edge requires HTTPS for camera/microphone access when using IP addresses. Please use localhost instead.';
      } else {
        statusEl.textContent = 'Your browser does not support camera/microphone access. Please use Chrome, Firefox, Safari, or Edge.';
      }
    } else {
      statusEl.textContent = 'Failed to access camera/microphone: ' + error.message;
    }
  }
}

async function leaveRoom() {
  try {
    if (localTrack) {
      localTrack.forEach(t => t.stop());
      localTrack.forEach(t => t.close());
      localTrack = null;
      localPlayer.innerHTML = '';
    }
    if (localAudioTrack) {
      localAudioTrack.stop();
      localAudioTrack.close();
      localAudioTrack = null;
    }
    if (localVideoTrack) {
      localVideoTrack.stop();
      localVideoTrack.close();
      localVideoTrack = null;
    }
    if (client) {
      await client.leave();
      client.removeAllListeners();
      client = null;
    }
  } finally {
    joined = false;
    statusEl.textContent = '';
    joinBtn.classList.remove('hidden');
    joinBtn.disabled = false;
    leaveBtn.classList.add('hidden');
    mediaControls.classList.add('hidden');
    remotePlayer.innerHTML = '';
    cameraEnabled = true;
    micEnabled = true;
    requestPermissionsBtn.style.display = 'none';
    toggleCameraBtn.style.display = 'inline-block';
    toggleMicBtn.style.display = 'inline-block';
  }
}

// UI events
createRoomBtn.addEventListener('click', () => {
  const id = generateRoomId();
  const link = buildRoomUrl(id);
  shareSection.classList.remove('hidden');
  roomLinkInput.value = link;
});

copyLinkBtn.addEventListener('click', async () => {
  if (!roomLinkInput.value) return;
  await navigator.clipboard.writeText(roomLinkInput.value);
  copyLinkBtn.textContent = 'Copied!';
  setTimeout(() => (copyLinkBtn.textContent = 'Copy'), 1200);
});

goRoomBtn.addEventListener('click', () => {
  const id = (roomIdInput.value || '').trim();
  if (!id) return;
  window.location.search = `?room=${encodeURIComponent(id)}`;
});

copyLinkBtn2.addEventListener('click', async () => {
  if (!roomLink2.value) return;
  await navigator.clipboard.writeText(roomLink2.value);
  copyLinkBtn2.textContent = 'Copied!';
  setTimeout(() => (copyLinkBtn2.textContent = 'Copy'), 1200);
});

joinBtn.addEventListener('click', joinRoom);
leaveBtn.addEventListener('click', leaveRoom);
toggleCameraBtn.addEventListener('click', toggleCamera);
toggleMicBtn.addEventListener('click', toggleMic);
requestPermissionsBtn.addEventListener('click', requestPermissions);

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  // Check media devices support
  checkMediaDevicesSupport();
  
  // Show home by default while we compute route, then route
  homeView.classList.remove('hidden');
  route();
});

window.addEventListener('popstate', route);


