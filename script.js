// Browser Support Check
if (!window.MediaRecorder || !window.indexedDB) {
    alert("Your browser does not support the required features for this application. Please use a modern browser like Chrome or Firefox.");
    // Disable the record button if elements are loaded
    window.addEventListener('DOMContentLoaded', () => {
        const recordButton = document.getElementById('recordButton');
        if (recordButton) {
            recordButton.disabled = true;
        }
    });
}

// DOM Element References
const recordButton = document.getElementById('recordButton');
const recordingControls = document.getElementById('recordingControls');
const pauseButton = document.getElementById('pauseButton');
const stopButton = document.getElementById('stopButton');
const timer = document.getElementById('timer');
const recordingsList = document.getElementById('recordingsList');

// State Variables for Recording
let mediaRecorder;
let audioChunks = [];
let recordingStartTime;
let timerInterval;
let pausedTime = 0;
let isPaused = false;

// State Variables for Audio Playback
let currentAudio = null;
let currentPlayButton = null;

// IndexedDB Helper
let db;

// Utility function to format file size in readable format
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return `${size}${sizes[i]}`;
}

function initDB() {
    const request = indexedDB.open('voice_recorder_db', 1);
    
    request.onupgradeneeded = function(event) {
        db = event.target.result;
        
        // Create recordings object store
        const objectStore = db.createObjectStore('recordings', {
            keyPath: 'id',
            autoIncrement: true
        });
        
        // Create index on createdAt field for sorting by date
        objectStore.createIndex('createdAt', 'createdAt', { unique: false });
    };
    
    request.onsuccess = function(event) {
        db = event.target.result;
        console.log('Database opened successfully');
        cleanupOldRecordings();
    };
    
    request.onerror = function(event) {
        console.error('Database error:', event.target.error);
    };
}

// Display Recordings Function
function displayRecordings() {
    recordingsList.innerHTML = '';
    
    // Create a transaction on the recordings object store
    const transaction = db.transaction(['recordings'], 'readonly');
    const objectStore = transaction.objectStore('recordings');
    const request = objectStore.getAll();
    
    request.onsuccess = function(event) {
        const recordings = event.target.result;
        
        // If no recordings, show placeholder message
        if (recordings.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'Your recordings will appear here.';
            recordingsList.appendChild(li);
            return;
        }
        
        // Reverse array to show newest first
        recordings.reverse();
        
        // Create list items for each recording
        recordings.forEach(recording => {
            const li = document.createElement('li');
            li.setAttribute('data-id', recording.id);
            
            // Create title span
            const titleSpan = document.createElement('span');
            titleSpan.className = 'recording-title';
            titleSpan.textContent = recording.title;
            
            // Create duration span
            const durationSpan = document.createElement('span');
            durationSpan.textContent = recording.duration;
            
            // Create file size span
            const fileSizeSpan = document.createElement('span');
            fileSizeSpan.className = 'file-size';
            fileSizeSpan.textContent = recording.fileSize ? formatFileSize(recording.fileSize) : 'Unknown size';
            
            // Create play button
            const playBtn = document.createElement('button');
            playBtn.className = 'play-btn';
            playBtn.textContent = 'Play';
            playBtn.setAttribute('data-state', 'play');
            
            // Create download button
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-btn';
            downloadBtn.textContent = 'Download';
            
            // Create delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = 'Delete';
            
            // Append all elements to the list item
            li.appendChild(titleSpan);
            li.appendChild(durationSpan);
            li.appendChild(fileSizeSpan);
            li.appendChild(playBtn);
            li.appendChild(downloadBtn);
            li.appendChild(deleteBtn);
            
            // Append list item to the recordings list
            recordingsList.appendChild(li);
        });
    };
    
    request.onerror = function(event) {
        console.error('Error fetching recordings:', event.target.error);
        const li = document.createElement('li');
        li.textContent = 'Error loading recordings.';
        recordingsList.appendChild(li);
    };
}

// Auto-Deletion Function
function cleanupOldRecordings() {
    const tenDaysAgo = new Date().getTime() - (10 * 24 * 60 * 60 * 1000);
    
    const transaction = db.transaction(['recordings'], 'readwrite');
    const objectStore = transaction.objectStore('recordings');
    const cursorRequest = objectStore.openCursor();
    
    cursorRequest.onsuccess = function(event) {
        const cursor = event.target.result;
        
        if (cursor) {
            const recording = cursor.value;
            
            // Check if recording is older than 10 days
            if (recording.createdAt.getTime() < tenDaysAgo) {
                cursor.delete();
            }
            
            cursor.continue();
        } else {
            // Cursor iteration complete, refresh display
            displayRecordings();
        }
    };
    
    cursorRequest.onerror = function(event) {
        console.error('Error during cleanup:', event.target.error);
    };
}

// Start Recording Logic
recordButton.addEventListener('click', () => {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            recordingStartTime = new Date();
            
            // Create MediaRecorder instance
            mediaRecorder = new MediaRecorder(stream);
            
            // Handle data available event
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            // Handle stop event - save recording
            mediaRecorder.onstop = () => {
                // Create blob from audio chunks
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = []; // Reset chunks
                
                // Calculate duration
                const durationSeconds = (new Date() - recordingStartTime) / 1000;
                const minutes = Math.floor(durationSeconds / 60);
                const seconds = Math.floor(durationSeconds % 60);
                const duration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
                // Create default title with current date/time
                const now = new Date();
                const year = now.getFullYear();
                const month = (now.getMonth() + 1).toString().padStart(2, '0');
                const day = now.getDate().toString().padStart(2, '0');
                const hours = now.getHours().toString().padStart(2, '0');
                const mins = now.getMinutes().toString().padStart(2, '0');
                const title = `${year}-${month}-${day} ${hours}:${mins} - Recording`;
                
                // Create recording object
                const recording = {
                    title: title,
                    duration: duration,
                    createdAt: new Date(),
                    audio: audioBlob,
                    fileSize: audioBlob.size
                };
                
                // Save to IndexedDB
                const transaction = db.transaction(['recordings'], 'readwrite');
                const objectStore = transaction.objectStore('recordings');
                objectStore.add(recording);
                
                transaction.oncomplete = () => {
                    displayRecordings(); // Refresh the list
                };
                
                transaction.onerror = (event) => {
                    console.error('Error saving recording:', event.target.error);
                    
                    // Handle storage quota exceeded error
                    if (event.target.error.name === 'QuotaExceededError') {
                        alert('Storage quota exceeded. Please free up some space by deleting old recordings.');
                        event.preventDefault();
                    }
                };
            };
            
            // Start recording
            mediaRecorder.start();
            
            // Start timer
            timerInterval = setInterval(() => {
                if (!isPaused) {
                    const elapsed = new Date() - recordingStartTime - pausedTime;
                    const minutes = Math.floor(elapsed / 60000);
                    const seconds = Math.floor((elapsed % 60000) / 1000);
                    timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                }
            }, 1000);
            
            // Update UI
            recordButton.style.display = 'none';
            recordingControls.classList.add('active');
        })
        .catch(error => {
            console.error('Error accessing microphone:', error);
            alert('Microphone access was denied. You need to allow microphone access to create a recording.');
        });
});

// Stop Recording Logic
stopButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        
        // Stop all tracks to release microphone
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    
    // Clear timer interval
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    // Reset timer variables
    pausedTime = 0;
    isPaused = false;
    pauseButton.textContent = 'Pause';
    
    // Reset timer display
    timer.textContent = '00:00';
    
    // Update UI
    recordButton.style.display = 'block';
    recordingControls.classList.remove('active');
});

// Pause/Resume Recording Logic
pauseButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        isPaused = true;
        pauseButton.textContent = 'Resume';
    } else if (mediaRecorder && mediaRecorder.state === 'paused') {
        const pauseEndTime = new Date();
        pausedTime += pauseEndTime - recordingStartTime;
        recordingStartTime = pauseEndTime;
        
        mediaRecorder.resume();
        isPaused = false;
        pauseButton.textContent = 'Pause';
    }
});

// Recording Management Features - Event Delegation
recordingsList.addEventListener('click', (event) => {
    // Delete Recording
    if (event.target.classList.contains('delete-btn')) {
        const listItem = event.target.closest('li');
        const recordingId = listItem.getAttribute('data-id');
        const recordingTitle = listItem.querySelector('.recording-title').textContent;
        
        if (confirm(`Are you sure you want to delete "${recordingTitle}"?`)) {
            const transaction = db.transaction(['recordings'], 'readwrite');
            const objectStore = transaction.objectStore('recordings');
            objectStore.delete(Number(recordingId));
            
            transaction.oncomplete = () => {
                displayRecordings(); // Refresh the list
            };
            
            transaction.onerror = (event) => {
                console.error('Error deleting recording:', event.target.error);
            };
        }
    }
    
    // Play/Pause Recording
    else if (event.target.classList.contains('play-btn')) {
        const playButton = event.target;
        const listItem = playButton.closest('li');
        const recordingId = listItem.getAttribute('data-id');
        const currentState = playButton.getAttribute('data-state');
        
        if (currentState === 'play') {
            // Stop any currently playing audio
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                if (currentPlayButton) {
                    currentPlayButton.textContent = 'Play';
                    currentPlayButton.setAttribute('data-state', 'play');
                }
            }
            
            // Get the recording from IndexedDB and play it
            const transaction = db.transaction(['recordings'], 'readonly');
            const objectStore = transaction.objectStore('recordings');
            const request = objectStore.get(Number(recordingId));
            
            request.onsuccess = (event) => {
                const recording = event.target.result;
                if (recording) {
                    // Create audio element and play
                    const audioUrl = URL.createObjectURL(recording.audio);
                    currentAudio = new Audio(audioUrl);
                    currentPlayButton = playButton;
                    
                    // Update button state
                    playButton.textContent = 'Pause';
                    playButton.setAttribute('data-state', 'pause');
                    
                    // Play the audio
                    currentAudio.play();
                    
                    // Handle audio end event
                    currentAudio.addEventListener('ended', () => {
                        playButton.textContent = 'Play';
                        playButton.setAttribute('data-state', 'play');
                        URL.revokeObjectURL(audioUrl);
                        currentAudio = null;
                        currentPlayButton = null;
                    });
                    
                    // Handle audio error
                    currentAudio.addEventListener('error', () => {
                        console.error('Error playing audio');
                        playButton.textContent = 'Play';
                        playButton.setAttribute('data-state', 'play');
                        URL.revokeObjectURL(audioUrl);
                        currentAudio = null;
                        currentPlayButton = null;
                    });
                }
            };
            
            request.onerror = (event) => {
                console.error('Error getting recording for playback:', event.target.error);
            };
        } else {
            // Pause the currently playing audio
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                playButton.textContent = 'Play';
                playButton.setAttribute('data-state', 'play');
                currentAudio = null;
                currentPlayButton = null;
            }
        }
    }
    
    // Download Recording
    else if (event.target.classList.contains('download-btn')) {
        const listItem = event.target.closest('li');
        const recordingId = listItem.getAttribute('data-id');
        
        const transaction = db.transaction(['recordings'], 'readonly');
        const objectStore = transaction.objectStore('recordings');
        const request = objectStore.get(Number(recordingId));
        
        request.onsuccess = (event) => {
            const recording = event.target.result;
            if (recording) {
                // Create download link
                const url = URL.createObjectURL(recording.audio);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${recording.title}.webm`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        };
        
        request.onerror = (event) => {
            console.error('Error downloading recording:', event.target.error);
        };
    }
    
    // Rename Recording (in-place editing)
    else if (event.target.classList.contains('recording-title')) {
        const titleSpan = event.target;
        const listItem = titleSpan.closest('li');
        const recordingId = listItem.getAttribute('data-id');
        const currentTitle = titleSpan.textContent;
        
        // Create input element
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.className = 'recording-title-input';
        
        // Replace span with input
        titleSpan.parentNode.replaceChild(input, titleSpan);
        input.focus();
        input.select();
        
        // Save rename function
        const saveRename = (event) => {
            const isEnterKey = event.type === 'keydown' && event.key === 'Enter';
            const isBlur = event.type === 'blur';
            
            if (isEnterKey || isBlur) {
                const newTitle = input.value.trim();
                
                if (newTitle && newTitle !== currentTitle) {
                    // Update in IndexedDB
                    const transaction = db.transaction(['recordings'], 'readwrite');
                    const objectStore = transaction.objectStore('recordings');
                    const getRequest = objectStore.get(Number(recordingId));
                    
                    getRequest.onsuccess = (event) => {
                        const recording = event.target.result;
                        if (recording) {
                            recording.title = newTitle;
                            const updateRequest = objectStore.put(recording);
                            
                            updateRequest.onsuccess = () => {
                                displayRecordings(); // Refresh the list
                            };
                            
                            updateRequest.onerror = (event) => {
                                console.error('Error updating recording title:', event.target.error);
                                displayRecordings(); // Refresh to restore original state
                            };
                        }
                    };
                    
                    getRequest.onerror = (event) => {
                        console.error('Error getting recording for rename:', event.target.error);
                        displayRecordings(); // Refresh to restore original state
                    };
                } else {
                    // No change or empty title, just refresh
                    displayRecordings();
                }
                
                // Remove event listeners
                input.removeEventListener('blur', saveRename);
                input.removeEventListener('keydown', saveRename);
            }
        };
        
        // Add event listeners
        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', saveRename);
    }
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(error => {
                console.log('ServiceWorker registration failed: ', error);
            });
    });
}

// Initialize when page loads
window.addEventListener('load', () => {
    initDB();
});
