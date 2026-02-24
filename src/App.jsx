import React, { useState, useEffect, useRef } from 'react';
import { 
  Book, 
  Bookmark, 
  ChevronLeft, 
  ChevronRight, 
  Sun, 
  Moon, 
  Type, 
  List, 
  StickyNote, 
  Clock, 
  FileUp,
  Trash2,
  X,
  Home,
  BookOpen,
  Navigation,
  Hash,
  Search,
  Volume2,
  Play,
  Pause,
  Maximize2,
  BarChart3,
  Settings2,
  Edit2,
  Plus,
  Download,
  Tag as TagIcon,
  Timer,
  Layout
} from 'lucide-react';

// --- Configuration ---
const PDFJS_VERSION = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

const THEMES = {
  light: { bg: 'bg-white', text: 'text-gray-900', secondary: 'bg-gray-100', accent: 'blue-600' },
  dark: { bg: 'bg-zinc-900', text: 'text-zinc-100', secondary: 'bg-zinc-800', accent: 'blue-400' },
  sepia: { bg: 'bg-[#f4ecd8]', text: 'text-[#5b4636]', secondary: 'bg-[#e9dec2]', accent: 'amber-700' }
};

// --- Storage Logic ---
const DB_NAME = 'KindleReaderDB_v4';
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
  // --- Standard State ---
  const [libReady, setLibReady] = useState(false);
  const [pdfFile, setPdfFile] = useState(null); 
  const [pdfDoc, setPdfDoc] = useState(null);   
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [theme, setTheme] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('nav'); 
  const [library, setLibrary] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [chapters, setChapters] = useState([]);

  // --- UI & Experience State ---
  const [focusMode, setFocusMode] = useState(false);
  const [isTwoPage, setIsTwoPage] = useState(false);
  const [margins, setMargins] = useState(40); // px
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [jumpPageInput, setJumpPageInput] = useState('');

  // --- Reading Intel State ---
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [totalTimeInBook, setTotalTimeInBook] = useState(0);
  const [readingStreak, setReadingStreak] = useState(1);

  // --- TTS State ---
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const synth = window.speechSynthesis;

  // --- Search State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Refs
  const canvasRef = useRef(null);
  const canvasTwoRef = useRef(null);
  const fileInputRef = useRef(null);
  const pdfjsLibRef = useRef(null);

  // --- Initialization & Lifecycle ---
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

    const activityTimer = setInterval(() => {
      if (pdfDoc && Date.now() - lastActivity > 3000 && !sidebarOpen) {
        setFocusMode(true);
      }
    }, 1000);

    return () => clearInterval(activityTimer);
  }, [lastActivity, sidebarOpen, pdfDoc]);

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
    setBookmarks(JSON.parse(localStorage.getItem('k_bookmarks_v2') || '[]'));
    setNotes(JSON.parse(localStorage.getItem('k_notes_v2') || '[]'));
    setReadingStreak(parseInt(localStorage.getItem('k_streak') || '1'));
  };

  useEffect(() => { localStorage.setItem('k_bookmarks_v2', JSON.stringify(bookmarks)); }, [bookmarks]);
  useEffect(() => { localStorage.setItem('k_notes_v2', JSON.stringify(notes)); }, [notes]);

  useEffect(() => {
    if (pdfDoc && libReady) {
      renderPage(currentPage, canvasRef);
      if (isTwoPage && currentPage < numPages) {
        renderPage(currentPage + 1, canvasTwoRef);
      }
      const meta = library.find(b => b.id === pdfFile);
      if (meta) updateMeta({ ...meta, lastPage: currentPage, lastOpened: Date.now(), totalTime: totalTimeInBook });
    }
  }, [pdfDoc, currentPage, scale, theme, libReady, isTwoPage, margins]);

  // --- Logic Enhancements ---

  const extractOutline = async (doc) => {
    try {
      const outline = await doc.getOutline();
      if (!outline) { setChapters([]); return; }

      const walkOutline = async (items) => {
        let results = [];
        for (const item of items) {
          let pageNum = null;
          try {
            if (item.dest) {
              let dest = item.dest;
              if (typeof dest === 'string') dest = await doc.getDestination(dest);
              if (Array.isArray(dest)) {
                const pageIdx = await doc.getPageIndex(dest[0]);
                pageNum = pageIdx + 1;
              }
            }
          } catch (err) { console.warn("Chapter resolution error:", err); }
          
          results.push({ 
            id: Math.random().toString(36).substr(2, 9), 
            title: item.title, 
            page: pageNum 
          });

          if (item.items && item.items.length > 0) {
            const nested = await walkOutline(item.items);
            results = [...results, ...nested];
          }
        }
        return results;
      };

      const allChapters = await walkOutline(outline);
      setChapters(allChapters.filter(c => c.page !== null));
    } catch (e) { 
      console.error("Outline extraction error:", e);
      setChapters([]); 
    }
  };

  const generateCoverImage = async (doc) => {
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.5 }); 
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.8); 
    } catch (e) { 
      console.error("Cover generation error:", e);
      return null; 
    }
  };

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

  const handleSpeak = async () => {
    if (isSpeaking) {
      synth.cancel();
      setIsSpeaking(false);
      return;
    }
    const page = await pdfDoc.getPage(currentPage);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(s => s.str).join(' ');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speechRate;
    utterance.onend = () => setIsSpeaking(false);
    synth.speak(utterance);
    setIsSpeaking(true);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    setIsSearching(true);
    const results = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(s => s.str).join(' ').toLowerCase();
      if (text.includes(searchQuery.toLowerCase())) {
        results.push({ page: i, preview: text.substr(text.indexOf(searchQuery.toLowerCase()), 50) });
      }
      if (results.length > 20) break;
    }
    setSearchResults(results);
    setIsSearching(false);
  };

  const exportNotes = (format) => {
    const bookNotes = notes.filter(n => n.file === pdfFile);
    let content = `# Notes for ${pdfFile}\n\n`;
    bookNotes.forEach(n => {
      content += `## Page ${n.page} (${n.color || 'Standard'})\n${n.content}\n\n`;
    });
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdfFile}_notes.${format}`;
    a.click();
  };

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const buf = ev.target.result;
        if (!buf) throw new Error("File buffer is empty");
        
        const id = file.name;

        // Save to DB immediately with null cover to avoid DataCloneError if we wait too long
        const meta = { id, name: file.name, lastPage: 1, lastOpened: Date.now(), cover: null, totalTime: 0 };
        await saveBookToDB(meta, buf);
        
        // Pass a copy for PDF.js processing
        const loadingTask = pdfjsLibRef.current.getDocument({ data: new Uint8Array(buf) });
        const pdf = await loadingTask.promise;
        
        // Generate cover image
        const cover = await generateCoverImage(pdf);
        await extractOutline(pdf);
        
        // Final update with the actual cover
        await updateMeta({ ...meta, cover });
        
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setPdfFile(id);
        setIsLoading(false);
        loadLib();
      } catch (err) { 
        console.error("PDF Load Error:", err);
        setIsLoading(false); 
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const openBook = async (book) => {
    setIsLoading(true); 
    try {
      const data = await getFile(book.id); 
      if (!data) throw new Error("Stored file data not found");
      
      const pdf = await pdfjsLibRef.current.getDocument({ data: new Uint8Array(data) }).promise; 
      
      // Healing logic: Generate cover if missing (for legacy uploads)
      if (!book.cover) {
        const cover = await generateCoverImage(pdf);
        if (cover) {
          await updateMeta({ ...book, cover, lastOpened: Date.now() });
          // Background reload library data to show the cover instantly in state
          const db = await initDB();
          const tx = db.transaction(METADATA_STORE, 'readonly');
          const req = tx.objectStore(METADATA_STORE).getAll();
          req.onsuccess = () => setLibrary(req.result.sort((a,b) => b.lastOpened - a.lastOpened));
        }
      }

      await extractOutline(pdf);
      setPdfDoc(pdf); 
      setNumPages(pdf.numPages); 
      setPdfFile(book.id); 
      setCurrentPage(book.lastPage || 1); 
      setTotalTimeInBook(book.totalTime || 0);
      setSessionSeconds(0);
    } catch (err) { 
      console.error("Open Book Error:", err); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const formatTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const deleteBook = async (e, id) => {
    e.stopPropagation();
    if (confirm("Delete this book from your library?")) {
      const db = await initDB();
      const tx = db.transaction([METADATA_STORE, FILE_STORE], 'readwrite');
      tx.objectStore(METADATA_STORE).delete(id);
      tx.objectStore(FILE_STORE).delete(id);
      tx.oncomplete = () => loadLib();
    }
  };

  return (
    <div 
      className={`h-screen ${THEMES[theme].bg} ${THEMES[theme].text} transition-all duration-700 flex flex-col font-sans select-none overflow-hidden`}
      onMouseMove={() => { setFocusMode(false); setLastActivity(Date.now()); }}
    >
      {/* Sidebar Navigation */}
      <div className={`fixed inset-y-0 left-0 w-80 ${THEMES[theme].secondary} shadow-2xl transform transition-transform duration-500 z-50 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-gray-500/10 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Settings2 size={18} className="opacity-50" />
            <h2 className="font-bold uppercase tracking-widest text-xs">Library Tools</h2>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-black/10 rounded-full transition-transform active:scale-90"><X size={20} /></button>
        </div>
        
        <div className="flex overflow-x-auto no-scrollbar border-b border-gray-500/10 bg-black/5">
          {[
            { id: 'nav', icon: <Navigation size={14}/>, label: 'GO TO' },
            { id: 'bookmarks', icon: <Bookmark size={14}/>, label: 'MARKS' },
            { id: 'notes', icon: <StickyNote size={14}/>, label: 'NOTES' },
            { id: 'search', icon: <Search size={14}/>, label: 'FIND' },
            { id: 'stats', icon: <BarChart3 size={14}/>, label: 'INTEL' }
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setSidebarTab(tab.id)} 
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[9px] font-bold transition-all ${sidebarTab === tab.id ? 'bg-blue-600 text-white shadow-inner' : 'opacity-40 hover:opacity-100'}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scroll">
          {sidebarTab === 'nav' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4">
              <section>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-[10px] font-bold uppercase tracking-wider opacity-50">Jump to Page</label>
                  <span className="text-[10px] font-mono opacity-30">Max: {numPages}</span>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const p = parseInt(jumpPageInput); if(p >= 1 && p <= numPages) { setCurrentPage(p); setSidebarOpen(false); } }} className="flex gap-2">
                  <input 
                    type="number" value={jumpPageInput} onChange={(e) => setJumpPageInput(e.target.value)}
                    placeholder={`e.g. 42`}
                    className={`flex-1 px-4 py-2 text-sm rounded-xl border border-gray-500/10 ${THEMES[theme].bg} focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-inner`}
                  />
                  <button type="submit" className="bg-blue-600 text-white px-4 rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20">GO</button>
                </form>
              </section>

              <section>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-[10px] font-bold uppercase tracking-wider opacity-50">Table of Contents</label>
                  <button onClick={() => { const t = prompt("Chapter Title:"); if(t) setChapters([...chapters, { id: Date.now(), title: t, page: currentPage }]); }} className="p-1 hover:bg-blue-600/10 rounded text-blue-600"><Plus size={14}/></button>
                </div>
                <div className="space-y-1">
                  {chapters.length === 0 ? <p className="text-xs opacity-30 italic p-2">No chapters detected.</p> : chapters.map((chapter) => (
                    <div key={chapter.id} className="flex group">
                      <button 
                        onClick={() => { setCurrentPage(chapter.page); setSidebarOpen(false); }}
                        className={`flex-1 text-left p-3 rounded-l-xl text-sm transition-all flex justify-between items-center ${currentPage >= chapter.page ? 'bg-blue-600/5 font-bold border-l-2 border-blue-600' : 'hover:bg-black/5'}`}
                      >
                        <span className="truncate w-40">{chapter.title}</span>
                        <span className="text-[10px] opacity-30 font-mono">p.{chapter.page}</span>
                      </button>
                      <button onClick={() => { const n = prompt("Rename:", chapter.title); if(n) setChapters(chapters.map(c => c.id === chapter.id ? {...c, title: n} : c)) }} className="px-2 opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity"><Edit2 size={12}/></button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {sidebarTab === 'notes' && (
            <div className="space-y-5 animate-in fade-in">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold uppercase tracking-wider opacity-50">Notebook</label>
                <button onClick={() => exportNotes('md')} className="text-[10px] font-bold flex items-center gap-1 text-blue-600 hover:underline"><Download size={12}/> EXPORT MD</button>
              </div>
              <div className="space-y-4">
                {notes.filter(n => n.file === pdfFile).map(n => (
                  <div key={n.id} className={`p-4 rounded-2xl ${THEMES[theme].bg} border-l-4 border-blue-500 shadow-sm transition-transform hover:-translate-y-0.5`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-bold opacity-40">PAGE {n.page}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setNotes(notes.filter(x => x.id !== n.id))} className="text-red-400 hover:text-red-600 transition-colors"><Trash2 size={12}/></button>
                      </div>
                    </div>
                    <p className="text-sm italic leading-relaxed">"{n.content}"</p>
                    {n.tag && <div className="mt-2 flex items-center gap-1 text-[9px] font-bold opacity-50"><TagIcon size={10}/> {n.tag}</div>}
                  </div>
                ))}
              </div>
              <button 
                onClick={() => { const v = prompt("Your Note:"); if(v) setNotes([...notes, { id: Date.now(), page: currentPage, file: pdfFile, content: v, tag: 'Uncategorized' }]); }}
                className="w-full py-3 bg-blue-600 text-white rounded-2xl text-xs font-bold shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
              >
                Capture Note at Page {currentPage}
              </button>
            </div>
          )}

          {sidebarTab === 'stats' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-4 rounded-2xl ${THEMES[theme].bg} border border-gray-500/10 text-center`}>
                  <div className="text-xl font-bold font-mono">{readingStreak}</div>
                  <div className="text-[9px] font-bold uppercase opacity-40">Day Streak</div>
                </div>
                <div className={`p-4 rounded-2xl ${THEMES[theme].bg} border border-gray-500/10 text-center`}>
                  <div className="text-xl font-bold font-mono">{formatTime(totalTimeInBook)}</div>
                  <div className="text-[9px] font-bold uppercase opacity-40">Total Read</div>
                </div>
              </div>
              
              <div className={`p-5 rounded-3xl ${THEMES[theme].bg} border border-gray-500/10`}>
                <div className="flex items-center gap-2 mb-4">
                  <Timer size={16} className="text-blue-600" />
                  <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-60">This Session</h4>
                </div>
                <div className="text-3xl font-serif font-bold mb-1">{formatTime(sessionSeconds)}</div>
                <div className="w-full bg-black/5 h-1 rounded-full overflow-hidden mt-4">
                  <div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${Math.min(100, (sessionSeconds / 1800) * 100)}%` }} />
                </div>
                <p className="text-[9px] opacity-40 mt-2 font-bold uppercase">Daily Goal: 30 Minutes</p>
              </div>
            </div>
          )}

          {sidebarTab === 'search' && (
            <div className="space-y-4 animate-in fade-in">
               <form onSubmit={handleSearch} className="relative">
                 <input 
                  type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search book..."
                  className={`w-full pl-10 pr-4 py-3 text-sm rounded-2xl border border-gray-500/10 ${THEMES[theme].bg} focus:ring-2 focus:ring-blue-500 focus:outline-none`}
                 />
                 <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" />
               </form>
               {isSearching ? <div className="text-center py-10 animate-pulse text-xs opacity-50">Searching...</div> : (
                 <div className="space-y-2">
                   {searchResults.map((res, i) => (
                     <button 
                      key={i} onClick={() => { setCurrentPage(res.page); setSidebarOpen(false); }}
                      className={`w-full text-left p-4 rounded-2xl text-xs hover:bg-black/5 border border-transparent hover:border-gray-500/10 transition-all ${THEMES[theme].bg}`}
                     >
                       <div className="font-bold mb-1 text-blue-600">Page {res.page}</div>
                       <p className="opacity-50 line-clamp-2 italic">"...{res.preview}..."</p>
                     </button>
                   ))}
                 </div>
               )}
            </div>
          )}
        </div>
      </div>

      {/* Main Navbar */}
      <nav className={`h-16 flex items-center justify-between px-6 border-b border-gray-500/10 ${THEMES[theme].secondary} z-40 shrink-0 transition-transform duration-500 ${focusMode ? '-translate-y-full' : 'translate-y-0'}`}>
        <div className="flex items-center gap-4">
          <button onClick={() => { setPdfDoc(null); loadLib(); }} className="p-2 hover:bg-black/5 rounded-full transition-all active:scale-90"><Home size={20} /></button>
          {pdfDoc && <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-black/5 rounded-full transition-all active:scale-90"><List size={20} /></button>}
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-blue-500" />
            <h1 className="text-sm font-bold truncate max-w-[120px] tracking-tight">{pdfDoc ? pdfFile : 'Kindle Library'}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {pdfDoc && (
            <>
              <div className="hidden lg:flex items-center gap-1 bg-black/5 p-1 rounded-xl mr-2">
                <button onClick={() => setIsTwoPage(!isTwoPage)} className={`p-1.5 rounded-lg transition-all ${isTwoPage ? 'bg-white shadow-sm text-blue-600' : 'opacity-30'}`} title="Two-Page Mode"><Layout size={16}/></button>
                <div className="w-px h-4 bg-gray-500/20 mx-1" />
                <button onClick={() => setMargins(m => Math.max(0, m - 10))} className="p-1.5 opacity-30 hover:opacity-100 rounded-lg"><Maximize2 size={14}/></button>
                <button onClick={() => setMargins(m => Math.min(200, m + 10))} className="p-1.5 opacity-30 hover:opacity-100 rounded-lg rotate-180"><Maximize2 size={14}/></button>
              </div>
              <div className="flex items-center gap-1 bg-black/5 p-1 rounded-xl mr-2">
                <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="p-1 px-3 hover:bg-white hover:shadow-sm rounded-lg text-xs font-bold transition-all">-</button>
                <span className="text-[10px] opacity-60 w-12 text-center font-mono font-bold">{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale(s => Math.min(4, s + 0.2))} className="p-1 px-3 hover:bg-white hover:shadow-sm rounded-lg text-xs font-bold transition-all">+</button>
              </div>
              <button onClick={handleSpeak} className={`p-1.5 rounded-lg ${isSpeaking ? 'bg-blue-600 text-white animate-pulse' : 'opacity-40'}`} title="Read Aloud"><Volume2 size={16}/></button>
            </>
          )}

          <div className="flex bg-black/5 p-1 rounded-xl">
            {['light', 'sepia', 'dark'].map(t => (
              <button key={t} onClick={() => setTheme(t)} className={`p-1.5 rounded-lg transition-all ${theme === t ? 'bg-white shadow-sm' : 'opacity-30'}`}>
                {t === 'light' ? <Sun size={14} /> : t === 'sepia' ? <Type size={14} /> : <Moon size={14} />}
              </button>
            ))}
          </div>

          {!pdfDoc ? (
            <button onClick={() => fileInputRef.current.click()} className="px-5 py-2 bg-blue-600 text-white rounded-full text-xs font-bold shadow-lg shadow-blue-600/20 transition-transform active:scale-95"><FileUp size={14} className="inline mr-2"/> IMPORT</button>
          ) : (
            <button onClick={() => { const exists = bookmarks.find(b => b.page === currentPage && b.file === pdfFile); if(exists) setBookmarks(bookmarks.filter(b => b.id !== exists.id)); else setBookmarks([...bookmarks, { id: Date.now(), page: currentPage, file: pdfFile }]); }} className={`p-2 transition-all ${bookmarks.some(b => b.page === currentPage && b.file === pdfFile) ? 'text-red-500' : 'opacity-30'}`}><Bookmark fill="currentColor" size={20} /></button>
          )}
          <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={onFile} />
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-black/[0.03] relative flex justify-center items-start scroll-smooth kindle-scroller custom-scroll">
        {!pdfDoc ? (
          <div className="w-full max-w-6xl mt-12 px-8 direction-ltr pb-24 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="flex items-end justify-between mb-10">
              <div>
                <h2 className="text-4xl font-bold font-serif tracking-tight">Your Bookshelf</h2>
                <p className="text-sm opacity-40 font-medium mt-2">Manage your collection and reading streak.</p>
              </div>
              <div className={`px-5 py-2 rounded-2xl ${THEMES[theme].secondary} border border-gray-500/10 flex items-center gap-3`}>
                <Timer size={16} className="text-blue-600"/>
                <span className="text-xs font-bold font-mono">{formatTime(library.reduce((acc, b) => acc + (b.totalTime || 0), 0))}</span>
              </div>
            </div>

            {library.length === 0 ? (
              <div className="text-center py-32 bg-black/5 rounded-[3rem] border-2 border-dashed border-gray-500/10">
                <BookOpen size={64} className="mx-auto opacity-10 mb-6"/>
                <p className="text-lg opacity-40 font-medium">Your library is waiting for its first resident.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-8 gap-y-12">
                {library.map(book => (
                  <div key={book.id} onClick={() => openBook(book)} className="cursor-pointer group flex flex-col transition-all active:scale-95">
                    <div className="relative aspect-[2/3] rounded-2xl mb-5 overflow-hidden border border-black/5 shadow-lg group-hover:shadow-2xl transition-all duration-700">
                      {book.cover ? (
                        <img src={book.cover} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" alt={book.name} />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${THEMES[theme].secondary} opacity-40`}><BookOpen size={48} /></div>
                      )}
                      <div className="absolute inset-y-0 left-0 w-[6px] bg-gradient-to-r from-black/30 to-transparent opacity-60" />
                    </div>
                    <h3 className="text-sm font-bold line-clamp-2 h-10 leading-tight group-hover:text-blue-600 transition-colors uppercase text-[11px] opacity-80">{book.name.replace('.pdf', '')}</h3>
                    <div className="mt-2 flex justify-between items-center opacity-30 text-[9px] font-bold tracking-widest px-1">
                       <button onClick={(e) => { e.stopPropagation(); deleteBook(e, book.id); }} className="p-1.5 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={12}/></button>
                       <span>PG {book.lastPage}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="relative group w-fit h-fit flex flex-col items-center py-10 direction-ltr transition-all duration-500" style={{ paddingLeft: `${margins}px`, paddingRight: `${margins}px` }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className={`fixed left-12 top-1/2 -translate-y-1/2 p-5 bg-white/95 dark:bg-zinc-800/90 backdrop-blur-xl shadow-2xl rounded-full z-30 transition-all duration-500 hover:scale-110 active:scale-95 ${focusMode ? 'opacity-0 -translate-x-full' : 'opacity-100 translate-x-0'}`}><ChevronLeft size={28}/></button>
            <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} className={`fixed right-12 top-1/2 -translate-y-1/2 p-5 bg-white/95 dark:bg-zinc-800/90 backdrop-blur-xl shadow-2xl rounded-full z-30 transition-all duration-500 hover:scale-110 active:scale-95 ${focusMode ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}><ChevronRight size={28}/></button>
            <div className="flex gap-6 transition-all duration-500">
              <div className={`shadow-2xl rounded-sm relative transition-all duration-300 ${theme === 'sepia' ? 'sepia-[0.1]' : ''}`}>
                <canvas ref={canvasRef} className={`block rounded shadow-inner ${theme === 'dark' ? 'invert-[0.92] hue-rotate-180 brightness-95 contrast-110' : ''}`} />
              </div>
              {isTwoPage && currentPage < numPages && (
                <div className={`shadow-2xl rounded-sm relative transition-all duration-300 animate-in fade-in slide-in-from-right-10 ${theme === 'sepia' ? 'sepia-[0.1]' : ''}`}>
                  <canvas ref={canvasTwoRef} className={`block rounded shadow-inner ${theme === 'dark' ? 'invert-[0.92] hue-rotate-180 brightness-95 contrast-110' : ''}`} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer Progress */}
      {pdfDoc && (
        <footer className={`h-20 ${THEMES[theme].secondary} border-t border-gray-500/10 flex flex-col justify-center px-10 z-40 shrink-0 transition-transform duration-500 ${focusMode ? 'translate-y-full' : 'translate-y-0'}`}>
          <div className="flex justify-between items-center text-[10px] font-bold opacity-40 mb-3 uppercase tracking-widest">
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-1.5"><Clock size={12}/> {Math.round((numPages - currentPage) * 1.5)} MIN REMAINING</span>
              <span className="flex items-center gap-1.5"><Timer size={12}/> SESSION: {formatTime(sessionSeconds)}</span>
            </div>
            <span>LOC {currentPage} of {numPages} ({Math.round((currentPage/numPages)*100)}%)</span>
          </div>
          <div className="w-full bg-black/5 h-2 rounded-full relative overflow-hidden shadow-inner">
            <div className="bg-blue-600 h-full transition-all duration-1000 shadow-[0_0_15px_rgba(37,99,235,0.4)]" style={{ width: `${(currentPage/numPages)*100}%` }} />
            <input type="range" min="1" max={numPages} value={currentPage} onChange={e => setCurrentPage(parseInt(e.target.value))} className="absolute inset-0 opacity-0 cursor-pointer w-full z-10" />
          </div>
        </footer>
      )}

      {isLoading && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-500">
          <div className="bg-white dark:bg-zinc-800 p-10 rounded-[3rem] shadow-2xl flex flex-col items-center">
            <div className="w-12 h-12 border-[6px] border-blue-600 border-t-transparent rounded-full animate-spin mb-6 shadow-xl shadow-blue-600/20"></div>
            <p className="font-bold text-lg tracking-tight font-serif">Optimizing for Reading...</p>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap');
        .kindle-scroller { direction: rtl; }
        .direction-ltr { direction: ltr; }
        .custom-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.02); }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 20px; border: 2px solid transparent; background-clip: content-box; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        input[type=range] { -webkit-appearance: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .font-serif { font-family: 'Libre Baskerville', serif; }
      `}} />
    </div>
  );
};

export default App;
