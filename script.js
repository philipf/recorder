// Browser Support Check and Audio Format Detection
let supportedMimeType = null;

function detectSupportedAudioFormat() {
    const testTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
        'audio/wav'
    ];
    
    for (const type of testTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            console.log('✅ Supported audio format found:', type);
            return type;
        }
    }
    
    console.warn('⚠️ No optimal audio format found, using default');
    return 'audio/webm'; // Fallback
}

if (!window.MediaRecorder || !window.indexedDB) {
    alert("Your browser does not support the required features for this application. Please use a modern browser like Chrome or Firefox.");
    // Disable the record button if elements are loaded
    window.addEventListener('DOMContentLoaded', () => {
        const recordButton = document.getElementById('recordButton');
        if (recordButton) {
            recordButton.disabled = true;
        }
    });
} else {
    // Detect the best supported audio format
    supportedMimeType = detectSupportedAudioFormat();
    console.log('🎵 Using audio format:', supportedMimeType);
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
let pauseStartTime = null; // Track when pause started

// Draft Save Variables (v1.1.0)
let draftSaveInterval;
let currentDraftId = null;
let lastDraftSaveTime = null;
const DRAFT_SAVE_INTERVAL_MS = 30000; // 30 seconds

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
    return new Promise((resolve, reject) => {
        console.log('🔧 Opening IndexedDB connection...');
        const request = indexedDB.open('voice_recorder_db', 2); // Increment version for schema change
        
        request.onupgradeneeded = function(event) {
            console.log('⬆️ Database upgrade needed, creating/updating schema...');
            db = event.target.result;
            
            // Create recordings object store if it doesn't exist
            if (!db.objectStoreNames.contains('recordings')) {
                console.log('📦 Creating recordings object store...');
                const recordingsStore = db.createObjectStore('recordings', {
                    keyPath: 'id',
                    autoIncrement: true
                });
                recordingsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            
            // Create drafts object store for periodic saves (v1.1.0)
            if (!db.objectStoreNames.contains('drafts')) {
                console.log('📦 Creating drafts object store...');
                const draftsStore = db.createObjectStore('drafts', {
                    keyPath: 'id'
                });
                
                // Create index on lastSaveTime field for cleanup
                draftsStore.createIndex('lastSaveTime', 'lastSaveTime', { unique: false });
            }
            console.log('✅ Database schema setup complete');
        };
        
        request.onsuccess = function(event) {
            db = event.target.result;
            console.log('✅ Database opened successfully and ready for use');
            console.log('📊 Database info:', {
                name: db.name,
                version: db.version,
                objectStores: Array.from(db.objectStoreNames)
            });
            cleanupOldRecordings();
            resolve(db);
        };
        
        request.onerror = function(event) {
            console.error('❌ Database error:', event.target.error);
            reject(event.target.error);
        };
        
        request.onblocked = function(event) {
            console.warn('⚠️ Database upgrade blocked - close other tabs with this app');
        };
    });
}

// Helper functions for button state management
function resetAllButtons() {
    const allListItems = document.querySelectorAll('#recordingsList li[data-id]');
    allListItems.forEach(listItem => {
        resetButtonsForRecording(listItem);
    });
}

function resetButtonsForRecording(listItem) {
    const playButton = listItem.querySelector('.play-btn');
    const pauseButton = listItem.querySelector('.pause-btn');
    const resumeButton = listItem.querySelector('.resume-btn');
    
    if (playButton && pauseButton && resumeButton) {
        playButton.style.display = 'inline-block';
        pauseButton.style.display = 'none';
        resumeButton.style.display = 'none';
    }
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
            
            // Create play button (always starts from beginning)
            const playBtn = document.createElement('button');
            playBtn.className = "audio-control-button play-btn";
            playBtn.textContent = '▶️';
            playBtn.title = 'Play from beginning';
            playBtn.setAttribute('data-state', 'stopped');
            
            // Create pause button (initially hidden)
            const pauseBtn = document.createElement('button');
            pauseBtn.className = "audio-control-button pause-btn";
            pauseBtn.textContent = '⏸️';
            pauseBtn.title = 'Pause';
            pauseBtn.style.display = 'none';
            pauseBtn.setAttribute('data-state', 'hidden');
            
            // Create resume button (initially hidden)
            const resumeBtn = document.createElement('button');
            resumeBtn.className = "audio-control-button resume-btn";
            resumeBtn.textContent = '⏯️';
            resumeBtn.title = 'Resume from pause';
            resumeBtn.style.display = 'none';
            resumeBtn.setAttribute('data-state', 'hidden');
            
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
            li.appendChild(pauseBtn);
            li.appendChild(resumeBtn);
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
            if (recording.timestamp) {
                const recordingTime = typeof recording.timestamp === 'string' 
                    ? new Date(recording.timestamp).getTime() 
                    : recording.timestamp.getTime();
                
                if (recordingTime < tenDaysAgo) {
                    cursor.delete();
                }
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

// Draft Management Functions (v1.1.0)
function saveDraftRecording() {
    if (!mediaRecorder || audioChunks.length === 0 || !currentDraftId) {
        console.log('❌ Draft save skipped:', {
            hasMediaRecorder: !!mediaRecorder,
            audioChunksLength: audioChunks.length,
            currentDraftId: currentDraftId
        });
        return;
    }
    
    console.log('💾 Starting draft save...', {
        draftId: currentDraftId,
        chunksCount: audioChunks.length,
        totalChunkSize: audioChunks.reduce((total, chunk) => total + chunk.size, 0) + ' bytes'
    });
    
    // Create blob from current chunks
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    
    // Calculate current duration
    const currentTime = new Date();
    const durationSeconds = (currentTime - recordingStartTime - pausedTime) / 1000;
    
    const draftRecording = {
        id: currentDraftId,
        title: 'Recording in progress...',
        audio: audioBlob,
        startTime: recordingStartTime,
        lastSaveTime: currentTime,
        isDraft: true,
        durationSeconds: durationSeconds,
        pausedTime: pausedTime,
        chunkCount: audioChunks.length
    };
    
    console.log('💾 Draft recording object created:', {
        id: draftRecording.id,
        audioSize: audioBlob.size + ' bytes',
        durationSeconds: durationSeconds.toFixed(2),
        chunkCount: draftRecording.chunkCount
    });
    
    // Check if database is ready
    if (!db) {
        console.error('❌ Database not ready for draft save, skipping this save cycle');
        return;
    }
    
    // Save to IndexedDB drafts store
    const transaction = db.transaction(['drafts'], 'readwrite');
    const objectStore = transaction.objectStore('drafts');
    
    // Use put() to update existing draft or create new one
    const putRequest = objectStore.put(draftRecording);
    
    putRequest.onsuccess = () => {
        console.log('✅ Draft saved successfully to IndexedDB!', {
            draftId: currentDraftId,
            chunksCleared: audioChunks.length,
            timestamp: new Date().toISOString()
        });
        lastDraftSaveTime = currentTime;
        
        // Clear chunks from memory to reduce memory usage
        audioChunks = [];
        console.log('🧹 Memory cleared: audioChunks reset to empty array');
    };
    
    putRequest.onerror = (event) => {
        console.error('❌ Error saving draft to IndexedDB:', event.target.error);
    };
    
    transaction.oncomplete = () => {
        console.log('✅ Draft transaction completed successfully');
    };
    
    transaction.onerror = (event) => {
        console.error('❌ Draft transaction failed:', event.target.error);
    };
}

function finalizeDraftRecording(draftId, finalChunks = []) {
    console.log('🏁 Starting recording finalization...', {
        draftId: draftId,
        finalChunksCount: finalChunks.length,
        finalChunksSize: finalChunks.reduce((total, chunk) => total + chunk.size, 0) + ' bytes'
    });
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['drafts'], 'readwrite');
        const objectStore = transaction.objectStore('drafts');
        const getRequest = objectStore.get(draftId);
        
        getRequest.onsuccess = (event) => {
            const draftRecording = event.target.result;
            if (!draftRecording) {
                console.log('⚠️ No draft found for finalization, using fallback method', { draftId });
                resolve(null);
                return;
            }
            
            console.log('📦 Draft retrieved for finalization:', {
                draftId: draftRecording.id,
                draftAudioSize: draftRecording.audio.size + ' bytes',
                draftChunkCount: draftRecording.chunkCount,
                startTime: draftRecording.startTime
            });
            
            // Combine draft audio with any remaining chunks
            const chunks = [draftRecording.audio];
            if (finalChunks.length > 0) {
                chunks.push(new Blob(finalChunks, { type: 'audio/webm' }));
                console.log('🔗 Combining draft with final chunks:', {
                    draftSize: draftRecording.audio.size,
                    finalChunksSize: finalChunks.reduce((total, chunk) => total + chunk.size, 0)
                });
            }
            
            const finalAudioBlob = new Blob(chunks, { type: 'audio/webm' });
            console.log('🎵 Final audio blob created:', {
                totalSize: finalAudioBlob.size + ' bytes',
                type: finalAudioBlob.type
            });
            
            // Calculate final duration
            const endTime = new Date();
            const totalDurationSeconds = (endTime - draftRecording.startTime - (draftRecording.pausedTime || 0)) / 1000;
            const minutes = Math.floor(totalDurationSeconds / 60);
            const seconds = Math.floor(totalDurationSeconds % 60);
            const duration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            console.log('⏱️ Duration calculated:', {
                totalDurationSeconds: totalDurationSeconds.toFixed(2),
                pausedTime: draftRecording.pausedTime || 0,
                formattedDuration: duration
            });
            
            // Create final recording title
            const startTime = new Date(draftRecording.startTime);
            const year = startTime.getFullYear();
            const month = (startTime.getMonth() + 1).toString().padStart(2, '0');
            const day = startTime.getDate().toString().padStart(2, '0');
            const hours = startTime.getHours().toString().padStart(2, '0');
            const mins = startTime.getMinutes().toString().padStart(2, '0');
            const title = `${year}-${month}-${day} ${hours}:${mins} - Recording`;
            
            // Create final recording object
            const finalRecording = {
                title: title,
                duration: duration,
                createdAt: draftRecording.startTime,
                audio: finalAudioBlob,
                fileSize: finalAudioBlob.size,
                isDraft: false // Mark as finalized
            };
            
            console.log('📝 Final recording object created:', {
                title: finalRecording.title,
                duration: finalRecording.duration,
                fileSize: finalRecording.fileSize + ' bytes',
                createdAt: finalRecording.createdAt
            });
            
            // Save final recording to recordings store
            const recordingsTransaction = db.transaction(['recordings'], 'readwrite');
            const recordingsObjectStore = recordingsTransaction.objectStore('recordings');
            const addRequest = recordingsObjectStore.add(finalRecording);
            
            addRequest.onsuccess = () => {
                console.log('✅ Final recording saved to IndexedDB successfully!', {
                    title: finalRecording.title,
                    size: finalRecording.fileSize + ' bytes'
                });
                
                // Delete the draft after successful save using a new transaction
                const deleteTransaction = db.transaction(['drafts'], 'readwrite');
                const deleteObjectStore = deleteTransaction.objectStore('drafts');
                const deleteRequest = deleteObjectStore.delete(draftId);
                
                deleteRequest.onsuccess = () => {
                    console.log('🧹 Draft cleaned up from IndexedDB', { draftId });
                    resolve(finalRecording);
                };
                
                deleteRequest.onerror = (event) => {
                    console.error('⚠️ Error deleting draft after finalization:', event.target.error);
                    resolve(finalRecording); // Still resolve since recording was saved
                };
                
                deleteTransaction.onerror = (event) => {
                    console.error('⚠️ Delete transaction failed:', event.target.error);
                    resolve(finalRecording); // Still resolve since recording was saved
                };
            };
            
            addRequest.onerror = (event) => {
                console.error('❌ Error saving finalized recording to IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        };
        
        getRequest.onerror = (event) => {
            console.error('❌ Error getting draft for finalization:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Start Recording Logic
recordButton.addEventListener('click', () => {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            // --- Waveform Visualization Setup ---
            const waveformCanvas = document.getElementById('waveform');
            const waveformCtx = waveformCanvas.getContext('2d');
            let audioContext, analyser, sourceNode, animationId;

            // Create AudioContext and AnalyserNode
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 1024;
            sourceNode = audioContext.createMediaStreamSource(stream);
            sourceNode.connect(analyser);

            // Show canvas
            waveformCanvas.style.display = 'block';

            function drawWaveform() {
                const bufferLength = analyser.fftSize;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);
                waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
                waveformCtx.lineWidth = 2;
                waveformCtx.strokeStyle = '#4CAF50';
                waveformCtx.beginPath();
                const sliceWidth = waveformCanvas.width / bufferLength;
                let x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    const v = dataArray[i] / 128.0;
                    const y = (v * waveformCanvas.height) / 2;
                    if (i === 0) {
                        waveformCtx.moveTo(x, y);
                    } else {
                        waveformCtx.lineTo(x, y);
                    }
                    x += sliceWidth;
                }
                waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
                waveformCtx.stroke();
                animationId = requestAnimationFrame(drawWaveform);
            }
            drawWaveform();

            // Attach cleanup to mediaRecorder for stop
            function cleanupWaveform() {
                cancelAnimationFrame(animationId);
                waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
                waveformCanvas.style.display = 'none';
                if (audioContext) {
                    audioContext.close();
                }
            }
            // Save for later cleanup
            window._waveformCleanup = cleanupWaveform;
            
            recordingStartTime = new Date();
            currentDraftId = 'draft_' + recordingStartTime.getTime(); // Generate unique draft ID
            lastDraftSaveTime = recordingStartTime;
            
            console.log('🎙️ Recording started with draft save system', {
                draftId: currentDraftId,
                startTime: recordingStartTime.toISOString(),
                saveInterval: DRAFT_SAVE_INTERVAL_MS + 'ms'
            });
            
            // Create MediaRecorder instance with detected format
            const options = supportedMimeType ? { mimeType: supportedMimeType } : {};
            mediaRecorder = new MediaRecorder(stream, options);
            
            console.log('🎙️ MediaRecorder created with options:', {
                mimeType: supportedMimeType || 'default',
                options: options
            });
            
            // Handle data available event
            mediaRecorder.ondataavailable = (event) => {
                console.log('🎵 Audio chunk received:', {
                    chunkSize: event.data.size + ' bytes',
                    totalChunks: audioChunks.length + 1,
                    timestamp: new Date().toISOString()
                });
                audioChunks.push(event.data);
            };
                
            // Handle stop event - save recording using draft finalization
            mediaRecorder.onstop = async () => {
    // --- Waveform Visualization Cleanup ---
    if (window._waveformCleanup) {
        window._waveformCleanup();
        window._waveformCleanup = null;
    }
                console.log(' MediaRecorder stopped, starting save process...', {
                    currentDraftId: currentDraftId,
                    audioChunksCount: audioChunks.length,
                    audioChunksSize: audioChunks.reduce((total, chunk) => total + chunk.size, 0) + ' bytes'
                });
                    
                try {
                    // If we have a draft ID, finalize the recording using the draft system
                    if (currentDraftId) {
                        console.log(' Finalizing recording using draft system...', {
                            draftId: currentDraftId,
                            remainingChunks: audioChunks.length
                        });
                            
                        // Finalize the recording with any remaining chunks
                        const finalRecording = await finalizeDraftRecording(currentDraftId, audioChunks);
                            
                        if (finalRecording) {
                            console.log(' Recording finalized successfully!', {
                                title: finalRecording.title,
                                size: finalRecording.fileSize + ' bytes'
                            });
                        } else {
                            console.log(' Draft finalization returned null, falling back to direct save');
                            await fallbackDirectSave();
                        }
                    } else {
                        console.log(' No draft ID found, using direct save method');
                        await fallbackDirectSave();
                    }
                        
                    // Clear the chunks and reset state
                    audioChunks = [];
                    currentDraftId = null;
                        
                    // Refresh the recordings list
                    displayRecordings();
                        
                } catch (error) {
                    console.error(' Error during recording finalization:', error);
                    alert('Error saving recording. Please try again.');
                }
                    
                // Fallback function for direct save (when draft system fails)
                async function fallbackDirectSave() {
                    console.log(' Using fallback direct save method...');
                        
                    // Create blob from remaining audio chunks
                    const audioBlob = new Blob(audioChunks, { type: supportedMimeType || 'audio/webm' });
                        
                    // Calculate duration
                    const durationSeconds = (new Date() - recordingStartTime) / 1000;
                    const minutes = Math.floor(durationSeconds / 60);
                    const seconds = Math.floor(durationSeconds % 60);
                    const duration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                        
                    // Create recording title with timestamp
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = (now.getMonth() + 1).toString().padStart(2, '0');
                    const day = now.getDate().toString().padStart(2, '0');
                    const hours = now.getHours().toString().padStart(2, '0');
                    const mins = now.getMinutes().toString().padStart(2, '0');
                    const title = `${year}-${month}-${day} ${hours}:${mins} - Recording (Fallback)`;
                        
                    // Create recording object
                    const recording = {
                        title: title,
                        duration: duration,
                        createdAt: new Date(),
                        audio: audioBlob,
                        fileSize: audioBlob.size
                    };
                        
                    // Check if database is ready
                    if (!db) {
                        console.error(' Database not ready for fallback save');
                        throw new Error('Database not ready');
                    }
                        
                    // Save to IndexedDB
                    return new Promise((resolve, reject) => {
                        const transaction = db.transaction(['recordings'], 'readwrite');
                        const objectStore = transaction.objectStore('recordings');
                        const addRequest = objectStore.add(recording);
                            
                        addRequest.onsuccess = () => {
                            console.log(' Fallback save completed successfully');
                            resolve(recording);
                        };
                            
                        addRequest.onerror = (event) => {
                            console.error(' Error in fallback save:', event.target.error);
                            reject(event.target.error);
                        };
                            
                        transaction.onerror = (event) => {
                            console.error(' Fallback transaction failed:', event.target.error);
                            reject(event.target.error);
                        };
                    });
                }
            };
                
            // Start recording with timeslice to trigger ondataavailable during recording
            mediaRecorder.start(10000); // Request data every 10 seconds
            console.log(' MediaRecorder started with 10-second timeslice for periodic data events');
                
            
            // Start periodic draft save timer
            draftSaveInterval = setInterval(() => {
                console.log('⏰ Periodic draft save timer triggered', {
                    mediaRecorderState: mediaRecorder ? mediaRecorder.state : 'null',
                    currentDraftId: currentDraftId,
                    audioChunksCount: audioChunks.length,
                    intervalMs: DRAFT_SAVE_INTERVAL_MS
                });
                
                if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
                    console.log('✅ Conditions met for draft save, calling saveDraftRecording()');
                    saveDraftRecording();
                } else {
                    console.log('❌ Conditions not met for draft save:', {
                        hasMediaRecorder: !!mediaRecorder,
                        state: mediaRecorder ? mediaRecorder.state : 'null'
                    });
                }
            }, DRAFT_SAVE_INTERVAL_MS);
            
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
    console.log('🛑 Stop button clicked', {
        mediaRecorderState: mediaRecorder ? mediaRecorder.state : 'null',
        currentDraftId: currentDraftId,
        audioChunksCount: audioChunks.length
    });
    
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        console.log('✅ Stopping MediaRecorder...');
        mediaRecorder.stop();
        
        // Stop all tracks to release microphone
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        // Clear draft save interval
        if (draftSaveInterval) {
            clearInterval(draftSaveInterval);
            draftSaveInterval = null;
            console.log('⏰ Draft save interval cleared');
        }
    } else {
        console.log('❌ MediaRecorder not in recording/paused state');
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
    // --- Waveform Visualization Cleanup ---
    if (window._waveformCleanup) {
        window._waveformCleanup();
        window._waveformCleanup = null;
    }
});

// Pause/Resume Recording Logic
pauseButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        isPaused = true;
        pauseStartTime = new Date(); // Mark when pause started
        pauseButton.textContent = 'Resume';
    } else if (mediaRecorder && mediaRecorder.state === 'paused') {
        if (pauseStartTime) {
            pausedTime += new Date() - pauseStartTime; // Add pause duration
            pauseStartTime = null;
        }
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
    
    // Play Recording (always from beginning)
    else if (event.target.classList.contains('play-btn')) {
        const playButton = event.target;
        const listItem = playButton.closest('li');
        const recordingId = listItem.getAttribute('data-id');
        const pauseButton = listItem.querySelector('.pause-btn');
        const resumeButton = listItem.querySelector('.resume-btn');
        
        // Stop any currently playing audio from other recordings
        if (currentAudio && currentPlayButton && currentPlayButton !== playButton) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            resetAllButtons();
        }
        
        // Stop current audio if it's the same recording
        if (currentAudio && currentPlayButton === playButton) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
        }
        
        // Get recording from IndexedDB and play from beginning
        const transaction = db.transaction(['recordings'], 'readonly');
        const objectStore = transaction.objectStore('recordings');
        const request = objectStore.get(Number(recordingId));
        
        request.onsuccess = (event) => {
            const recording = event.target.result;
            if (recording) {
                // Create audio element and play from beginning
                const audioUrl = URL.createObjectURL(recording.audio);
                currentAudio = new Audio();
                currentPlayButton = playButton;
                
                // Set the source and load the audio
                currentAudio.src = audioUrl;
                currentAudio.load();
                
                // Update button states
                playButton.style.display = 'none';
                pauseButton.style.display = 'inline-block';
                resumeButton.style.display = 'none';
                
                // Handle successful load and play
                currentAudio.addEventListener('canplaythrough', () => {
                    console.log('🎵 Audio loaded successfully, starting playback');
                    currentAudio.play().catch(error => {
                        console.error('❌ Error starting playback:', error);
                        alert('Unable to play this recording. The audio format may not be supported.');
                        resetButtonsForRecording(listItem);
                        URL.revokeObjectURL(audioUrl);
                        currentAudio = null;
                        currentPlayButton = null;
                    });
                });
                
                // Handle audio end event
                currentAudio.addEventListener('ended', () => {
                    console.log('🎵 Audio playback ended');
                    resetButtonsForRecording(listItem);
                    URL.revokeObjectURL(audioUrl);
                    currentAudio = null;
                    currentPlayButton = null;
                });
                
                // Handle audio error with better logging
                currentAudio.addEventListener('error', (e) => {
                    console.error('❌ Audio playback error:', {
                        error: e.target.error,
                        code: e.target.error?.code,
                        message: e.target.error?.message,
                        audioFormat: recording.audio.type,
                        audioSize: recording.audio.size
                    });
                    
                    let errorMessage = 'Unable to play this recording.';
                    if (e.target.error?.code === 4) {
                        errorMessage += ' The audio format is not supported by your browser.';
                    }
                    
                    alert(errorMessage);
                    resetButtonsForRecording(listItem);
                    URL.revokeObjectURL(audioUrl);
                    currentAudio = null;
                    currentPlayButton = null;
                });
                
                // Handle load errors
                currentAudio.addEventListener('loadstart', () => {
                    console.log('🔄 Starting to load audio for playback');
                });
                
                currentAudio.addEventListener('loadeddata', () => {
                    console.log('📊 Audio data loaded, duration:', currentAudio.duration + 's');
                });
            }
        };
        
        request.onerror = (event) => {
            console.error('Error getting recording for playback:', event.target.error);
        };
    }
    
    // Pause Recording
    else if (event.target.classList.contains('pause-btn')) {
        const pauseButton = event.target;
        const listItem = pauseButton.closest('li');
        const playButton = listItem.querySelector('.play-btn');
        const resumeButton = listItem.querySelector('.resume-btn');
        
        if (currentAudio && currentPlayButton && currentPlayButton.closest('li') === listItem) {
            currentAudio.pause();
            
            // Update button states - show Play and Resume, hide Pause
            playButton.style.display = 'inline-block';
            pauseButton.style.display = 'none';
            resumeButton.style.display = 'inline-block';
        }
    }
    
    // Resume Recording
    else if (event.target.classList.contains('resume-btn')) {
        const resumeButton = event.target;
        const listItem = resumeButton.closest('li');
        const playButton = listItem.querySelector('.play-btn');
        const pauseButton = listItem.querySelector('.pause-btn');
        
        if (currentAudio && currentPlayButton && currentPlayButton.closest('li') === listItem) {
            currentAudio.play();
            
            // Update button states - show only Pause
            playButton.style.display = 'none';
            pauseButton.style.display = 'inline-block';
            resumeButton.style.display = 'none';
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
                // Listen for updates
                registration.onupdatefound = () => {
                    const newWorker = registration.installing;
                    newWorker.onstatechange = () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New or updated content is available
                            alert('A new version is available. Please refresh the page to update.');
                        }
                    };
                };
            })
            .catch(error => {
                console.log('ServiceWorker registration failed: ', error);
            });
    });
}

// Draft Recovery Function - Check for existing drafts on startup
async function checkForDraftRecordings() {
    return new Promise((resolve, reject) => {
        console.log('🔍 Checking for draft recordings to recover...');
        
        const transaction = db.transaction(['drafts'], 'readonly');
        const draftsStore = transaction.objectStore('drafts');
        const getAllRequest = draftsStore.getAll();
        
        getAllRequest.onsuccess = async (event) => {
            const drafts = event.target.result;
            
            if (drafts && drafts.length > 0) {
                console.log(`🔄 Found ${drafts.length} draft recording(s) to recover`);
                
                // Show recovery notification to user
                const recoveryMessage = drafts.length === 1 
                    ? 'A recording draft was found from a previous session. It will be recovered and saved to your recordings.'
                    : `${drafts.length} recording drafts were found from a previous session. They will be recovered and saved to your recordings.`;
                
                alert(`📁 Recovery Notice\n\n${recoveryMessage}`);
                
                // Process each draft for recovery
                let recoveredCount = 0;
                
                for (const draft of drafts) {
                    try {
                        await recoverDraftRecording(draft);
                        recoveredCount++;
                    } catch (error) {
                        console.error('❌ Failed to recover draft:', draft.id, error);
                    }
                }
                
                if (recoveredCount > 0) {
                    console.log(`✅ Successfully recovered ${recoveredCount} recording(s)`);
                    // Refresh the recordings list to show recovered items
                    displayRecordings();
                    
                    // Show success message
                    const successMessage = recoveredCount === 1
                        ? 'The draft recording has been successfully recovered and appears in your recordings list.'
                        : `${recoveredCount} draft recordings have been successfully recovered and appear in your recordings list.`;
                    
                    setTimeout(() => {
                        alert(`✅ Recovery Complete\n\n${successMessage}`);
                    }, 500);
                }
            } else {
                console.log('✅ No draft recordings found - clean startup');
            }
            
            resolve();
        };
        
        getAllRequest.onerror = (event) => {
            console.error('❌ Error checking for draft recordings:', event.target.error);
            resolve(); // Don't block startup on draft check failure
        };
    });
}

// Recover a single draft recording
async function recoverDraftRecording(draft) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Recovering draft recording:', draft.id);
        console.log('📊 Draft data structure:', {
            id: draft.id,
            title: draft.title,
            hasAudio: !!draft.audio,
            audioSize: draft.audio ? draft.audio.size : 0,
            durationSeconds: draft.durationSeconds,
            lastSaveTime: draft.lastSaveTime
        });
        
        // Validate that we have audio data to recover
        if (!draft.audio || draft.audio.size === 0) {
            console.error('❌ Draft has no audio data to recover:', draft.id);
            reject(new Error('No audio data in draft'));
            return;
        }
        
        // Format duration to match normal recordings (MM:SS format)
        const durationSeconds = Math.round(draft.durationSeconds || 0);
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        const formattedDuration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Create a recovered recording object using the correct draft properties
        const recoveredRecording = {
            title: `Recovered - ${draft.title || 'Untitled Recording'}`,
            timestamp: new Date().toISOString(),
            originalTimestamp: draft.lastSaveTime || draft.startTime,
            duration: formattedDuration, // Use formatted duration string to match normal recordings
            audio: draft.audio, // Store in 'audio' property to match normal recordings
            fileSize: draft.audio.size, // Use 'fileSize' property to match display expectations
            isRecovered: true
        };
        
        console.log('✅ Recovery object created:', {
            title: recoveredRecording.title,
            duration: recoveredRecording.duration,
            audioSize: recoveredRecording.size,
            hasAudio: !!recoveredRecording.audio
        });
        
        // Save to recordings store
        const transaction = db.transaction(['recordings', 'drafts'], 'readwrite');
        const recordingsStore = transaction.objectStore('recordings');
        const draftsStore = transaction.objectStore('drafts');
        
        // Add to recordings
        const addRequest = recordingsStore.add(recoveredRecording);
        
        addRequest.onsuccess = () => {
            console.log('✅ Draft recording saved to recordings store');
            
            // Delete the draft
            const deleteRequest = draftsStore.delete(draft.id);
            
            deleteRequest.onsuccess = () => {
                console.log('🗑️ Draft deleted after successful recovery');
                resolve();
            };
            
            deleteRequest.onerror = (event) => {
                console.error('⚠️ Failed to delete draft after recovery:', event.target.error);
                resolve(); // Still consider recovery successful
            };
        };
        
        addRequest.onerror = (event) => {
            console.error('❌ Failed to save recovered recording:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Initialize when page loads
window.addEventListener('load', async () => {
    console.log('📱 Page loaded, starting database initialization...');
    
    // Disable record button until database is ready
    recordButton.disabled = true;
    recordButton.textContent = 'Initializing...';
    
    try {
        console.log('🔄 Calling initDB()...');
        
        // Add timeout to catch initialization issues
        const dbPromise = initDB();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database initialization timeout')), 10000);
        });
        
        await Promise.race([dbPromise, timeoutPromise]);
        
        console.log('🚀 App fully initialized and ready for recording');
        console.log('🗄️ Database status:', { dbReady: !!db, dbName: db?.name });
        
        // Enable record button now that database is ready
        recordButton.disabled = false;
        recordButton.textContent = 'Start Recording';
        
        // Check for any draft recordings that need recovery
        await checkForDraftRecordings();
        
    } catch (error) {
        console.error('❌ Failed to initialize database:', error);
        recordButton.textContent = 'Database Error';
        alert('Failed to initialize the app. Please refresh the page.');
    }
});
