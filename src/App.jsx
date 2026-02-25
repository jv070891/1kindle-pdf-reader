import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Book, Bookmark, ChevronLeft, ChevronRight, Sun, Moon, Type, List, StickyNote, 
  Clock, FileUp, Trash2, X, Home, BookOpen, Navigation, Hash, Search, Volume2, 
  Play, Pause, Maximize2, BarChart3, Settings2, Edit2, Plus, Download, 
  Tag as TagIcon, Timer, Layout, MousePointer2, Settings, Sliders, Square, AlignLeft,
  Filter, Zap, RotateCcw
} from 'lucide-react';

// --- Configuration & Constants ---
const PDFJS_VERSION = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

const THEMES = {
  light: { bg: 'bg-white', text: 'text-gray-900', secondary: 'bg-gray-50', accent: 'blue-600', shadow: 'shadow-blue-900/5' },
  dark: { bg: 'bg-zinc-950', text: 'text-zinc-200', secondary: 'bg-zinc-900', accent: 'blue-500', shadow: 'shadow-black' },
  sepia: { bg: 'bg-[#f4ecd8]', text: 'text-[#5b4636]', secondary: 'bg-[#e9dec2]', accent: 'amber-800', shadow: 'shadow-amber-900/10' }
};

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#fef08a', border: 'border-yellow-400' },
  { name: 'Green', value: '#bbf7d0', border: 'border-green-400' },
  { name: 'Blue', value: '#bfdbfe', border: 'border-blue-400' },
  { name: 'Pink', value: '#fbcfe8', border: 'border-pink-400' }
];

// --- Storage Architecture ---
const DB_NAME = 'AldikoReaderDB_v5';
const METADATA_STORE = 'book_metadata';
const FILE_STORE = 'book_files';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(METADATA_STORE)) db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveBookToDB = async (metadata, fileData) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([METADATA_STORE, FILE_STORE], 'readwrite');
    transaction.objectStore(METADATA_STORE).put(metadata);
    transaction.objectStore(FILE_STORE).put({ id: metadata.id, data: fileData });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

const updateMeta = async (metadata) => {
  const db = await initDB();
  const tx = db.transaction(METADATA_STORE, 'readwrite');
  tx.objectStore(METADATA_STORE).put(metadata);
};

const getFile = async (id) => {
  const db = await initDB();
  return new Promise((resolve) => {
    const req = db.transaction(FILE_STORE, 'readonly').objectStore(FILE_STORE).get(id);
    req.onsuccess = () => resolve(req.result?.data);
  });
};

const App = () => {
  // --- Core Reader State ---
  const [libReady, setLibReady] = useState(false);
  const [pdfFile, setPdfFile] = useState(null); 
  const [pdfDoc, setPdfDoc] = useState(null);   
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [theme, setTheme] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('nav'); 
  const [library, setLibrary] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [chapters, setChapters] = useState([]);

  // --- Premium UI & Customization ---
  const [focusMode, setFocusMode] = useState(false);
  const [isTwoPage, setIsTwoPage] = useState(false);
  const [blueLightFilter, setBlueLightFilter] = useState(0);
  const [margins, setMargins] = useState(60); 
  const [lineSpacing, setLineSpacing] = useState(1.5);
  const [fontFamily, setFontFamily] = useState('serif');
  const [showSettings, setShowSettings] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [jumpPageInput, setJumpPageInput] = useState('');
  const [libSearch, setLibSearch] = useState('');

  // --- Intelligence & Stats ---
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [totalTimeInBook, setTotalTimeInBook] = useState(0);
  const [readingStreak, setReadingStreak] = useState(1);

  // --- TTS State ---
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.9); 
  const [selectedVoice, setSelectedVoice] = useState(null);
  const synth = window.speechSynthesis;

  // --- Search State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // --- Drag-to-Flip Physics ---
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragDirection, setDragDirection] = useState(null);

  // Refs
  const canvasRef = useRef(null);
  const canvasTwoRef = useRef(null);
  const fileInputRef = useRef(null);
  const pdfjsLibRef = useRef(null);
  const mainRef = useRef(null);

  // --- Initialization Logic ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = PDFJS_URL;
    script.async = true;
    script.onload = () => {
      pdfjsLibRef.current = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
      pdfjsLibRef.current.GlobalWorkerOptions.workerSrc = WORKER_URL;
      setLibReady(true);
    };
    document.head.appendChild(script);
    loadLib();

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (!voices.length) return;
      const preferred = voices.find(v => (v.name.includes('Natural') || v.name.includes('Male')) && v.lang.startsWith('en')) || voices[0];
      setSelectedVoice(preferred);
    };
    loadVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;

    // Focus Mode Logic: Auto-hide UI after 5s of no movement
    const activityTimer = setInterval(() => {
      if (pdfDoc && Date.now() - lastActivity > 5000 && !sidebarOpen && !showSettings) setFocusMode(true);
    }, 1000);

    return () => { clearInterval(activityTimer); synth.cancel(); };
  }, [lastActivity, sidebarOpen, pdfDoc, showSettings]);

  // Session Tracking
  useEffect(() => {
    let timer;
    if (pdfDoc && !isLoading) {
      timer = setInterval(() => {
        setSessionSeconds(prev => prev + 1);
        setTotalTimeInBook(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [pdfDoc, isLoading]);

  const loadLib = async () => {
    const db = await initDB();
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const req = tx.objectStore(METADATA_STORE).getAll();
    req.onsuccess = () => setLibrary(req.result.sort((a,b) => b.lastOpened - a.lastOpened));
    setBookmarks(JSON.parse(localStorage.getItem('aldiko_bookmarks') || '[]'));
    setNotes(JSON.parse(localStorage.getItem('aldiko_notes') || '[]'));
    setReadingStreak(parseInt(localStorage.getItem('aldiko_streak') || '1'));
  };

  useEffect(() => { localStorage.setItem('aldiko_bookmarks', JSON.stringify(bookmarks)); }, [bookmarks]);
  useEffect(() => { localStorage.setItem('aldiko_notes', JSON.stringify(notes)); }, [notes]);

  // --- Core PDF Processing & Rendering ---
  useEffect(() => {
    if (pdfDoc && libReady) {
      renderPage(currentPage, canvasRef);
      if (isTwoPage && currentPage < numPages) {
        renderPage(currentPage + 1, canvasTwoRef);
      }
      const meta = library.find(b => b.id === pdfFile);
      if (meta) updateMeta({ ...meta, lastPage: currentPage, lastOpened: Date.now(), totalTime: totalTimeInBook });
    }
  }, [pdfDoc, currentPage, scale, theme, libReady, isTwoPage, margins, lineSpacing, fontFamily]);

  const renderPage = async (num, ref) => {
    if (!pdfDoc || !ref.current) return;
    const page = await pdfDoc.getPage(num);
    const vp = page.getViewport({ scale });
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    canvas.height = vp.height;
    canvas.width = vp.width;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  };

  const extractOutline = async (doc) => {
    try {
      const outline = await doc.getOutline();
      if (!outline) { setChapters([]); return; }
      const walk = async (items) => {
        let res = [];
        for (const i of items) {
          let p = null;
          try {
            if (i.dest) {
              let d = i.dest;
              if (typeof d === 'string') d = await doc.getDestination(d);
              if (Array.isArray(d)) p = (await doc.getPageIndex(d[0])) + 1;
            }
          } catch (e) {}
          res.push({ id: Math.random().toString(36).substr(2, 9), title: i.title, page: p });
          if (i.items?.length) res = [...res, ...(await walk(i.items))];
        }
        return res;
      };
      const all = await walk(outline);
      setChapters(all.filter(c => c.page !== null));
    } catch (e) { setChapters([]); }
  };

  const generateCoverImage = async (doc) => {
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.4 }); 
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height; canvas.width = viewport.width;
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.8); 
    } catch (e) { return null; }
  };

  const activeChapter = useMemo(() => {
    if (!chapters.length) return null;
    return [...chapters].reverse().find(c => currentPage >= c.page);
  }, [chapters, currentPage]);

  // --- Interaction Logic ---
  const handleDragStart = (e) => {
    if (!pdfDoc || sidebarOpen || showSettings) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const width = window.innerWidth;
    if (clientX > width * 0.88) { setDragDirection('next'); setDragStartX(clientX); setIsDragging(true); } 
    else if (clientX < width * 0.12) { setDragDirection('prev'); setDragStartX(clientX); setIsDragging(true); }
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const delta = clientX - dragStartX;
    setDragOffset(dragDirection === 'next' ? Math.min(0, delta) : Math.max(0, delta));
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    const threshold = window.innerWidth * 0.25;
    if (dragDirection === 'next' && dragOffset < -threshold) {
      setCurrentPage(p => Math.min(numPages, isTwoPage ? p + 2 : p + 1));
    } else if (dragDirection === 'prev' && dragOffset > threshold) {
      setCurrentPage(p => Math.max(1, isTwoPage ? p - 2 : p - 1));
    }
    setIsDragging(false); setDragOffset(0); setDragDirection(null);
  };

  const toggleTTS = async () => {
    if (isSpeaking) { synth.cancel(); setIsSpeaking(false); return; }
    try {
      const page = await pdfDoc.getPage(currentPage);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(s => s.str).join(' ').trim();
      if (!text) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.pitch = 0.9; utterance.rate = speechRate;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      setTimeout(() => synth.speak(utterance), 50);
    } catch (e) { setIsSpeaking(false); }
  };

  // --- Library Logic ---
  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const buf = ev.target.result;
        const id = `${file.name}_${Date.now()}`;
        const meta = { id, name: file.name, lastPage: 1, lastOpened: Date.now(), cover: null, totalTime: 0, tags: [] };
        await saveBookToDB(meta, buf);
        const task = pdfjsLibRef.current.getDocument({ data: new Uint8Array(buf) });
        const pdf = await task.promise;
        const cover = await generateCoverImage(pdf);
        await extractOutline(pdf);
        await updateMeta({ ...meta, cover });
        setPdfDoc(pdf); setNumPages(pdf.numPages); setPdfFile(id); setIsLoading(false); loadLib();
      } catch (err) { setIsLoading(false); }
    };
    reader.readAsArrayBuffer(file);
  };

  const openBook = async (book) => {
    setIsLoading(true); 
    try {
      const data = await getFile(book.id); 
      const pdf = await pdfjsLibRef.current.getDocument({ data: new Uint8Array(data) }).promise; 
      await extractOutline(pdf);
      setPdfDoc(pdf); setNumPages(pdf.numPages); setPdfFile(book.id); 
      setCurrentPage(book.lastPage || 1); setTotalTimeInBook(book.totalTime || 0); setSessionSeconds(0);
    } catch (e) {} finally { setIsLoading(false); }
  };

  const exportNotes = () => {
    const bNotes = notes.filter(n => n.file === pdfFile);
    const content = `# Notebook: ${pdfFile}\n\n` + bNotes.map(n => `## Page ${n.page} [${n.colorName}]\n> ${n.content}\n`).join('\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${pdfFile}_notes.md`; a.click();
  };

  const formatTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const filteredLibrary = library.filter(b => b.name.toLowerCase().includes(libSearch.toLowerCase()));

  return (
    <div 
      className={`h-screen ${THEMES[theme].bg} ${THEMES[theme].text} transition-all duration-700 flex flex-col font-sans select-none overflow-hidden`}
      onMouseMove={() => { setFocusMode(false); setLastActivity(Date.now()); }}
    >
      {/* Eye Comfort Filter Overlay */}
      <div className="fixed inset-0 pointer-events-none z-[200] transition-opacity duration-1000" style={{ backgroundColor: 'rgba(255, 160, 0, 0.1)', opacity: blueLightFilter / 100 }} />

      {/* Premium Sidebar */}
      <div className={`fixed inset-y-0 left-0 w-80 ${THEMES[theme].secondary} shadow-2xl transform transition-transform duration-500 z-[100] flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-black/5 flex justify-between items-center bg-black/[0.02]">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-blue-600" />
            <h2 className="font-black uppercase tracking-tighter text-sm">Aldiko Suite</h2>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-black/5 rounded-full"><X size={18} /></button>
        </div>
        
        <div className="flex bg-black/5 p-1 mx-4 my-6 rounded-2xl">
          {[
            { id: 'nav', icon: <Navigation size={14}/>, label: 'Reader' },
            { id: 'notes', icon: <StickyNote size={14}/>, label: 'Notes' },
            { id: 'stats', icon: <BarChart3 size={14}/>, label: 'Analytics' }
          ].map(tab => (
            <button key={tab.id} onClick={() => setSidebarTab(tab.id)} className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all ${sidebarTab === tab.id ? 'bg-white shadow-xl text-blue-600 scale-[1.02]' : 'opacity-40 hover:opacity-100'}`}>
              {tab.icon}
              <span className="text-[9px] font-bold uppercase tracking-wider">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scroll">
          {sidebarTab === 'nav' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4">
              <section>
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-30 mb-3 block">Navigation</label>
                <form onSubmit={(e) => { e.preventDefault(); const p = parseInt(jumpPageInput); if(p >= 1 && p <= numPages) { setCurrentPage(p); setSidebarOpen(false); } }} className="flex gap-2">
                  <input type="number" value={jumpPageInput} onChange={(e) => setJumpPageInput(e.target.value)} placeholder={`Jump to (1-${numPages})`} className={`flex-1 px-4 py-3 text-sm rounded-2xl border border-black/5 ${THEMES[theme].bg} focus:ring-2 focus:ring-blue-500 outline-none shadow-inner`} />
                  <button type="submit" className="bg-blue-600 text-white px-5 rounded-2xl text-xs font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-transform">GO</button>
                </form>
              </section>
              <section>
                <div className="flex justify-between items-center mb-4">
                   <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-30">Outline</label>
                   <button onClick={() => { const t = prompt("Add Chapter Marker:"); if(t) setChapters([...chapters, { id: Date.now(), title: t, page: currentPage }]); }} className="text-blue-600 p-1 hover:bg-blue-50 rounded-lg"><Plus size={14}/></button>
                </div>
                <div className="space-y-1">
                  {chapters.length === 0 ? <p className="text-xs opacity-30 italic p-4 text-center border border-dashed border-black/10 rounded-2xl">No chapters detected.</p> : chapters.map((c) => (
                    <div key={c.id} className={`flex items-center group rounded-2xl transition-all ${activeChapter?.id === c.id ? 'bg-blue-600/5' : 'hover:bg-black/5'}`}>
                      <button onClick={() => { setCurrentPage(c.page); setSidebarOpen(false); }} className={`flex-1 text-left p-3.5 text-sm flex justify-between items-center ${activeChapter?.id === c.id ? 'font-black text-blue-600' : 'opacity-80'}`}>
                        <span className="truncate w-40">{c.title}</span>
                        <span className="text-[10px] opacity-30 font-mono">p.{c.page}</span>
                      </button>
                      <button onClick={() => { const n = prompt("Rename Chapter:", c.title); if(n) setChapters(chapters.map(ch => ch.id === c.id ? {...ch, title: n} : ch)) }} className="opacity-0 group-hover:opacity-40 p-2"><Edit2 size={12}/></button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
          {sidebarTab === 'notes' && (
            <div className="space-y-6">
               <div className="flex justify-between items-center px-1">
                 <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-30">Notebook</label>
                 <button onClick={exportNotes} className="text-blue-600 text-[10px] font-bold flex items-center gap-1 hover:underline"><Download size={12}/> EXPORT MD</button>
               </div>
               <div className="space-y-4">
                 {notes.filter(n => n.file === pdfFile).length === 0 ? <p className="text-center py-20 opacity-20 text-xs italic">No highlights recorded yet.</p> : notes.filter(n => n.file === pdfFile).map(n => (
                   <div key={n.id} className={`p-5 rounded-3xl ${THEMES[theme].bg} border-l-[6px] shadow-sm relative group transition-transform hover:-translate-y-0.5`} style={{ borderColor: n.color || '#3b82f6' }}>
                     <div className="flex justify-between items-center mb-3">
                       <span className="text-[9px] font-black opacity-30 tracking-widest">PG {n.page}</span>
                       <button onClick={() => setNotes(notes.filter(x => x.id !== n.id))} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity p-1 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                     </div>
                     <p className="text-sm italic leading-relaxed opacity-90">"{n.content}"</p>
                   </div>
                 ))}
               </div>
               <div className="grid grid-cols-4 gap-2 px-1 py-4 border-t border-black/5">
                 {HIGHLIGHT_COLORS.map(c => (
                   <button key={c.name} onClick={() => { const v = prompt(`Add ${c.name} Highlight:`); if(v) setNotes([...notes, { id: Date.now(), page: currentPage, file: pdfFile, content: v, color: c.value, colorName: c.name }]); }} className={`h-8 rounded-full border-2 ${c.border} shadow-sm active:scale-90 transition-transform`} style={{ backgroundColor: c.value }} title={c.name} />
                 ))}
               </div>
            </div>
          )}
          {sidebarTab === 'stats' && (
            <div className="space-y-8">
              <div className={`p-6 rounded-[2.5rem] bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30`}>
                <div className="flex items-center gap-2 opacity-80 mb-6">
                  <RotateCcw size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Global Reading Intel</span>
                </div>
                <div className="text-5xl font-black tracking-tighter mb-1">{readingStreak}</div>
                <div className="text-[10px] font-bold uppercase opacity-70 tracking-widest">Day Streak</div>
                <div className="mt-8 flex justify-between items-end">
                   <div>
                     <div className="text-xl font-bold font-mono">{formatTime(library.reduce((acc, b) => acc + (b.totalTime || 0), 0))}</div>
                     <div className="text-[9px] font-bold uppercase opacity-60">Total Time Spent</div>
                   </div>
                   <Zap size={24} className="opacity-30" />
                </div>
              </div>
              <div className={`p-6 rounded-[2rem] ${THEMES[theme].bg} border border-black/5 shadow-inner`}>
                <div className="flex items-center gap-2 mb-4 opacity-40">
                  <Timer size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">This Session</span>
                </div>
                <div className="text-3xl font-serif font-black">{formatTime(sessionSeconds)}</div>
                <div className="w-full bg-black/5 h-1 rounded-full overflow-hidden mt-5">
                  <div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${Math.min(100, (sessionSeconds / 1800) * 100)}%` }} />
                </div>
                <p className="text-[8px] font-black opacity-30 mt-3 uppercase tracking-widest">Daily Goal: 30 Minutes</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Responsive Navbar */}
      <nav className={`h-16 flex items-center justify-between px-6 border-b border-black/5 ${THEMES[theme].secondary} z-50 shrink-0 transition-transform duration-500 ${focusMode ? '-translate-y-full' : 'translate-y-0'}`}>
        <div className="flex items-center gap-4">
          <button onClick={() => { setPdfDoc(null); setPdfFile(null); loadLib(); }} className="p-2 hover:bg-black/5 rounded-xl transition-all active:scale-90"><Home size={22} /></button>
          {pdfDoc && <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-black/5 rounded-xl transition-all active:scale-90"><List size={22} /></button>}
          <div className="flex flex-col">
            <h1 className="text-sm font-black truncate max-w-[150px] leading-tight tracking-tight uppercase opacity-80">{pdfDoc ? pdfFile.split('_')[0] : 'Aldiko'}</h1>
            {activeChapter && <span className="text-[9px] font-bold text-blue-600 truncate max-w-[120px]">{activeChapter.title}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {pdfDoc && (
            <>
              <div className="hidden lg:flex items-center gap-1 bg-black/5 p-1 rounded-2xl mr-2">
                <button onClick={() => setIsTwoPage(!isTwoPage)} className={`p-2 rounded-xl transition-all ${isTwoPage ? 'bg-white text-blue-600 shadow-xl scale-105' : 'opacity-40'}`} title="Two-Page Spread"><Layout size={18}/></button>
                <div className="w-px h-5 bg-black/10 mx-1" />
                <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-xl transition-all ${showSettings ? 'bg-white text-blue-600 shadow-xl' : 'opacity-40'}`}><Settings size={18}/></button>
              </div>
              <div className="flex items-center gap-1 bg-black/5 p-1 rounded-2xl mr-2">
                <button onClick={() => setScale(s => Math.max(0.4, s - 0.1))} className="p-1 px-3 hover:bg-white rounded-xl text-xs font-bold transition-all">-</button>
                <span className="text-[10px] font-black opacity-60 w-10 text-center font-mono">{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale(s => Math.min(4, s + 0.1))} className="p-1 px-3 hover:bg-white rounded-xl text-xs font-bold">+</button>
              </div>
              <div className="flex items-center gap-1 bg-black/5 p-1 rounded-2xl">
                 <button onClick={toggleTTS} className={`p-2 rounded-xl transition-all ${isSpeaking ? 'bg-blue-600 text-white shadow-xl animate-pulse' : 'opacity-40 hover:opacity-100'}`} title="Text-to-Speech"><Volume2 size={18}/></button>
              </div>
            </>
          )}
          <div className="flex bg-black/5 p-1 rounded-2xl ml-2">
            {['light', 'sepia', 'dark'].map(t => (
              <button key={t} onClick={() => setTheme(t)} className={`p-1.5 rounded-xl transition-all ${theme === t ? 'bg-white shadow-lg text-blue-600' : 'opacity-40'}`}>
                {t === 'light' ? <Sun size={16} /> : t === 'sepia' ? <Type size={16} /> : <Moon size={16} />}
              </button>
            ))}
          </div>
          {!pdfDoc ? (
            <button onClick={() => fileInputRef.current.click()} className="ml-3 px-6 py-2.5 bg-blue-600 text-white rounded-full text-[11px] font-black tracking-widest shadow-xl shadow-blue-500/30 active:scale-95 transition-all uppercase">Import</button>
          ) : (
            <button onClick={() => { const exists = bookmarks.find(b => b.page === currentPage && b.file === pdfFile); if(exists) setBookmarks(bookmarks.filter(b => b.id !== exists.id)); else setBookmarks([...bookmarks, { id: Date.now(), page: currentPage, file: pdfFile }]); }} className={`p-2 transition-all ml-2 ${bookmarks.some(b => b.page === currentPage && b.file === pdfFile) ? 'text-red-500' : 'opacity-30'}`}><Bookmark fill="currentColor" size={24} /></button>
          )}
          <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={onFile} />
        </div>
      </nav>

      {/* Typography & Eye Comfort Settings */}
      {showSettings && (
        <div className={`fixed top-20 right-8 w-72 p-8 rounded-[2.5rem] z-[150] ${THEMES[theme].secondary} shadow-2xl border border-black/5 animate-in slide-in-from-top-6 duration-500`}>
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Reading Style</h3>
            <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-black/5 rounded-full"><X size={16}/></button>
          </div>
          <div className="space-y-8">
             <div className="space-y-4">
               <div className="flex justify-between items-center text-[10px] font-black opacity-40 uppercase tracking-widest"><span>Font Family</span> <Zap size={12}/></div>
               <div className="flex gap-2 p-1 bg-black/5 rounded-2xl">
                 <button onClick={() => setFontFamily('serif')} className={`flex-1 py-3 rounded-xl text-xs font-serif font-bold transition-all ${fontFamily === 'serif' ? 'bg-white shadow-xl scale-105' : 'opacity-40'}`}>Serif</button>
                 <button onClick={() => setFontFamily('sans')} className={`flex-1 py-3 rounded-xl text-xs font-sans font-bold transition-all ${fontFamily === 'sans' ? 'bg-white shadow-xl scale-105' : 'opacity-40'}`}>Sans</button>
               </div>
             </div>
             <div className="space-y-4">
               <div className="flex justify-between items-center text-[10px] font-black opacity-40 uppercase tracking-widest"><span>Comfort Filter</span> <Moon size={12}/></div>
               <input type="range" min="0" max="60" value={blueLightFilter} onChange={(e) => setBlueLightFilter(parseInt(e.target.value))} className="w-full accent-amber-600" />
             </div>
             <div className="space-y-4">
               <div className="flex justify-between items-center text-[10px] font-black opacity-40 uppercase tracking-widest"><span>Line Spacing</span> <AlignLeft size={12}/></div>
               <div className="flex gap-2">
                 {[1.2, 1.5, 2.0].map(s => (
                   <button key={s} onClick={() => setLineSpacing(s)} className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${lineSpacing === s ? 'bg-blue-600 text-white shadow-xl' : 'bg-black/5 opacity-40'}`}>{s}x</button>
                 ))}
               </div>
             </div>
          </div>
        </div>
      )}

      {/* Main Surface */}
      <main 
        ref={mainRef}
        className={`flex-1 overflow-y-auto relative flex justify-center items-start scroll-smooth kindle-scroller custom-scroll transition-colors duration-1000 ${fontFamily === 'serif' ? 'font-serif' : 'font-sans'} bg-black/[0.015]`}
        onMouseDown={handleDragStart} onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onMouseLeave={handleDragEnd}
        onTouchStart={handleDragStart} onTouchMove={handleDragMove} onTouchEnd={handleDragEnd}
      >
        {!pdfDoc ? (
          <div className="w-full max-w-6xl mt-16 px-10 pb-32 animate-in fade-in slide-in-from-bottom-12 duration-1000">
             <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12 gap-6">
               <div>
                 <h2 className="text-6xl font-black tracking-tighter leading-none mb-4">My Shelf</h2>
                 <p className="text-sm opacity-40 font-medium tracking-wide">Aldiko Premium Suite • Local Library Management</p>
               </div>
               <div className="relative group w-full md:w-80">
                 <input 
                  type="text" value={libSearch} onChange={(e) => setLibSearch(e.target.value)} 
                  placeholder="Search Library..."
                  className={`w-full pl-12 pr-6 py-4 rounded-[1.5rem] ${THEMES[theme].secondary} border border-black/5 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all shadow-sm`}
                 />
                 <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" />
               </div>
             </div>

             {filteredLibrary.length === 0 ? (
               <div className="text-center py-48 bg-black/[0.02] rounded-[5rem] border-2 border-dashed border-black/5 flex flex-col items-center">
                 <BookOpen size={64} className="opacity-10 mb-8"/>
                 <p className="text-xl opacity-30 font-medium tracking-tight">Your bookshelf is empty.</p>
                 <button onClick={() => fileInputRef.current.click()} className="mt-8 text-blue-600 font-black text-xs uppercase tracking-widest hover:underline">Import your first PDF</button>
               </div>
             ) : (
               <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-12 gap-y-20">
                 {filteredLibrary.map(book => (
                   <div key={book.id} onClick={() => openBook(book)} className="cursor-pointer group flex flex-col transition-all active:scale-95">
                     <div className="relative aspect-[2/3] rounded-[2rem] mb-8 overflow-hidden border border-black/5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] group-hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.25)] group-hover:translate-y-[-10px] transition-all duration-700 bg-white">
                       {book.cover ? (
                         <img src={book.cover} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" alt={book.name} />
                       ) : (
                         <div className={`w-full h-full flex items-center justify-center ${THEMES[theme].secondary} opacity-40`}><BookOpen size={48} /></div>
                       )}
                       <div className="absolute inset-y-0 left-0 w-[10px] bg-gradient-to-r from-black/25 to-transparent opacity-60" />
                       {book.lastPage > 1 && (
                         <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/10">
                           <div className="h-full bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.8)]" style={{ width: `${Math.min(100, (book.lastPage / 100) * 100)}%` }} />
                         </div>
                       )}
                     </div>
                     <h3 className="text-sm font-black line-clamp-2 h-10 leading-tight group-hover:text-blue-600 transition-colors tracking-tight uppercase opacity-80 mb-2">{book.name.split('_')[0]}</h3>
                     <div className="flex justify-between items-center opacity-30 text-[9px] font-black tracking-[0.15em]">
                        <button onClick={(e) => { e.stopPropagation(); if(confirm("Permanently remove this book?")) { /* Logic to delete from DB */ } }} className="p-2 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all"><Trash2 size={15}/></button>
                        <span className="bg-black/5 px-2.5 py-1 rounded-full uppercase">PG {book.lastPage}</span>
                     </div>
                   </div>
                 ))}
               </div>
             )}
          </div>
        ) : (
          <div 
            className="relative group w-fit h-fit flex flex-col items-center py-12 direction-ltr transition-all duration-700" 
            style={{ 
              paddingLeft: `${margins}px`, paddingRight: `${margins}px`,
              transform: `perspective(2500px) rotateY(${dragOffset / 65}deg) translateX(${dragOffset}px)`,
              cursor: isDragging ? 'grabbing' : 'auto'
            }}
          >
            <div className={`flex gap-1 relative`}>
              <div className={`shadow-[0_60px_120px_-20px_rgba(0,0,0,0.3)] rounded-sm relative transition-all duration-500 overflow-hidden ${theme === 'sepia' ? 'sepia-[0.1]' : ''}`}>
                <canvas ref={canvasRef} className={`block rounded-sm shadow-inner transition-all ${theme === 'dark' ? 'invert-[0.94] hue-rotate-180 brightness-90 contrast-[1.05]' : ''}`} />
                <div className="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-black/15 to-transparent pointer-events-none opacity-40" />
                {isDragging && dragDirection === 'next' && (
                  <div className="absolute inset-y-0 right-0 w-48 bg-gradient-to-l from-black/30 to-transparent pointer-events-none transition-opacity" style={{ opacity: Math.abs(dragOffset) / 300 }} />
                )}
              </div>
              
              {isTwoPage && currentPage < numPages && (
                <div className={`shadow-[0_60px_120px_-20px_rgba(0,0,0,0.3)] rounded-sm relative transition-all duration-500 overflow-hidden animate-in zoom-in-95 fade-in ${theme === 'sepia' ? 'sepia-[0.1]' : ''}`}>
                  <canvas ref={canvasTwoRef} className={`block rounded-sm shadow-inner transition-all ${theme === 'dark' ? 'invert-[0.94] hue-rotate-180 brightness-90 contrast-[1.05]' : ''}`} />
                  <div className="absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-black/15 to-transparent pointer-events-none opacity-40" />
                  {isDragging && dragDirection === 'prev' && (
                    <div className="absolute inset-y-0 left-0 w-48 bg-gradient-to-r from-black/30 to-transparent pointer-events-none transition-opacity" style={{ opacity: Math.abs(dragOffset) / 300 }} />
                  )}
                </div>
              )}
            </div>

            {/* Premium Gutter Indicator */}
            <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-black/10 opacity-0 group-hover:opacity-20 transition-opacity translate-x-[-1px] pointer-events-none" />

            {/* Floating Nav Controls */}
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className={`fixed left-12 top-1/2 -translate-y-1/2 p-7 bg-white/95 dark:bg-zinc-800/90 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.25)] rounded-full z-30 transition-all duration-500 hover:scale-110 active:scale-95 ${focusMode ? 'opacity-0 -translate-x-full' : 'opacity-100 translate-x-0'}`}><ChevronLeft size={36} className="text-blue-600"/></button>
            <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} className={`fixed right-12 top-1/2 -translate-y-1/2 p-7 bg-white/95 dark:bg-zinc-800/90 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.25)] rounded-full z-30 transition-all duration-500 hover:scale-110 active:scale-95 ${focusMode ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}><ChevronRight size={36} className="text-blue-600"/></button>
          </div>
        )}
      </main>

      {/* Enhanced Analytical Footer */}
      {pdfDoc && (
        <footer className={`h-24 ${THEMES[theme].secondary} border-t border-black/5 flex flex-col justify-center px-12 z-[60] shrink-0 transition-transform duration-700 ${focusMode ? 'translate-y-full' : 'translate-y-0'}`}>
          <div className="flex justify-between items-center text-[10px] font-black opacity-40 mb-5 uppercase tracking-[0.25em]">
            <div className="flex items-center gap-10">
              <span className="flex items-center gap-2.5 transition-all hover:text-blue-600 cursor-help"><Clock size={15}/> {Math.round((numPages - currentPage) * 1.5)} MINS REMAINING</span>
              <span className="flex items-center gap-2.5 text-blue-600"><Timer size={15}/> READING: {formatTime(sessionSeconds)}</span>
            </div>
            <div className="flex items-center gap-8">
              <span>LOC {currentPage} OF {numPages} ({Math.round((currentPage/numPages)*100)}%)</span>
              <div className="h-4 w-px bg-black/10" />
              <button onClick={() => setSidebarOpen(true)} className="hover:text-blue-600 transition-colors uppercase">Open Index</button>
            </div>
          </div>
          <div className="w-full bg-black/10 h-[3px] rounded-full relative overflow-hidden shadow-inner group cursor-pointer">
            <div className="bg-blue-600 h-full transition-all duration-1000 shadow-[0_0_20px_rgba(37,99,235,0.6)]" style={{ width: `${(currentPage/numPages)*100}%` }} />
            <input type="range" min="1" max={numPages} value={currentPage} onChange={e => setCurrentPage(parseInt(e.target.value))} className="absolute inset-0 opacity-0 cursor-pointer w-full z-10" />
          </div>
        </footer>
      )}

      {/* Professional Multi-stage Engine Loader */}
      {isLoading && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-2xl z-[300] flex items-center justify-center animate-in fade-in duration-700">
          <div className="p-16 rounded-[4rem] flex flex-col items-center text-center">
            <div className="relative mb-10">
               <div className="w-24 h-24 border-[8px] border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
               <Zap size={32} className="absolute inset-0 m-auto text-blue-600 animate-pulse" />
            </div>
            <p className="font-black text-3xl tracking-tighter text-white uppercase italic">Aldiko Premium Engine</p>
            <p className="text-[10px] text-white/40 mt-4 tracking-[0.4em] font-bold uppercase animate-pulse">Initializing Neural Layouts • 60FPS Enabled</p>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');
        
        .kindle-scroller { direction: rtl; }
        .direction-ltr { direction: ltr; }

        .custom-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.01); }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 20px; border: 3px solid transparent; background-clip: content-box; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }

        .no-scrollbar::-webkit-scrollbar { display: none; }

        input[type=range] { -webkit-appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #2563eb; border-radius: 50%; cursor: pointer; transition: scale 0.2s; }
        input[type=range]:hover::-webkit-slider-thumb { scale: 1.2; }

        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .font-serif { font-family: 'Libre Baskerville', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }
        
        canvas {
          transition: transform 0.2s cubic-bezier(0.2, 0, 0.1, 1);
          transform-origin: center;
          backface-visibility: hidden;
        }

        /* Aldiko Premium Texture Overlay */
        main::after {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.04;
          background-image: url('https://www.transparenttextures.com/patterns/handmade-paper.png');
          z-index: 100;
        }
      `}} />
    </div>
  );
};

export default App;
