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
  BookOpen
} from 'lucide-react';

// --- Configuration ---
const PDFJS_VERSION = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

const THEMES = {
  light: { bg: 'bg-white', text: 'text-gray-900', secondary: 'bg-gray-100' },
  dark: { bg: 'bg-zinc-900', text: 'text-gray-100', secondary: 'bg-zinc-800' },
  sepia: { bg: 'bg-[#f4ecd8]', text: 'text-[#5b4636]', secondary: 'bg-[#e9dec2]' }
};

// --- Storage Logic ---
const DB_NAME = 'KindleReaderDB_v3';
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
  const [libReady, setLibReady] = useState(false);
  const [pdfFile, setPdfFile] = useState(null); 
  const [pdfDoc, setPdfDoc] = useState(null);   
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [theme, setTheme] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('bookmarks'); 
  const [library, setLibrary] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [notes, setNotes] = useState([]);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const pdfjsLibRef = useRef(null);

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
  }, []);

  const loadLib = async () => {
    const db = await initDB();
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const req = tx.objectStore(METADATA_STORE).getAll();
    req.onsuccess = () => setLibrary(req.result.sort((a,b) => b.lastOpened - a.lastOpened));
    setBookmarks(JSON.parse(localStorage.getItem('k_bookmarks') || '[]'));
    setNotes(JSON.parse(localStorage.getItem('k_notes') || '[]'));
  };

  useEffect(() => { localStorage.setItem('k_bookmarks', JSON.stringify(bookmarks)); }, [bookmarks]);
  useEffect(() => { localStorage.setItem('k_notes', JSON.stringify(notes)); }, [notes]);

  useEffect(() => {
    if (pdfDoc && libReady) {
      renderPage(currentPage);
      const meta = library.find(b => b.id === pdfFile);
      if (meta) updateMeta({ ...meta, lastPage: currentPage, lastOpened: Date.now() });
    }
  }, [pdfDoc, currentPage, scale, theme, libReady]);

  // Helper function to generate a thumbnail of the first page
  const generateCoverImage = async (doc) => {
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.4 }); // Low scale for thumbnail
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.7); // Compressed JPEG
    } catch (e) {
      console.error("Could not generate cover", e);
      return null;
    }
  };

  const renderPage = async (num) => {
    const page = await pdfDoc.getPage(num);
    const vp = page.getViewport({ scale });
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.height = vp.height;
    canvas.width = vp.width;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  };

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const buf = ev.target.result;
        const id = `${file.name}_${Date.now()}`;
        
        const loadingTask = pdfjsLibRef.current.getDocument({ data: buf });
        const pdf = await loadingTask.promise;
        
        // Generate cover image string
        const cover = await generateCoverImage(pdf);
        
        const meta = { id, name: file.name, lastPage: 1, lastOpened: Date.now(), cover };
        await saveBookToDB(meta, buf);
        
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setPdfFile(id);
        setIsLoading(false);
        loadLib();
      } catch (err) {
        console.error(err);
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const deleteBook = async (e, id) => {
    e.stopPropagation();
    if (confirm("Delete this book?")) {
      const db = await initDB();
      const tx = db.transaction([METADATA_STORE, FILE_STORE], 'readwrite');
      tx.objectStore(METADATA_STORE).delete(id);
      tx.objectStore(FILE_STORE).delete(id);
      tx.oncomplete = () => loadLib();
    }
  }

  return (
    <div className={`h-screen ${THEMES[theme].bg} ${THEMES[theme].text} transition-colors flex flex-col font-sans select-none overflow-hidden`}>
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 w-80 ${THEMES[theme].secondary} shadow-2xl transform transition-transform z-50 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-gray-500/10 flex justify-between items-center">
          <h2 className="font-bold uppercase tracking-widest text-xs">Menu</h2>
          <button onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <div className="flex border-b border-gray-500/10">
          <button onClick={() => setSidebarTab('bookmarks')} className={`flex-1 p-3 text-xs font-bold ${sidebarTab === 'bookmarks' ? 'border-b-2 border-blue-500' : 'opacity-40'}`}>BOOKMARKS</button>
          <button onClick={() => setSidebarTab('notes')} className={`flex-1 p-3 text-xs font-bold ${sidebarTab === 'notes' ? 'border-b-2 border-blue-500' : 'opacity-40'}`}>NOTES</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {sidebarTab === 'bookmarks' && bookmarks.filter(b => b.file === pdfFile).map(b => (
            <div key={b.id} onClick={() => { setCurrentPage(b.page); setSidebarOpen(false); }} className={`p-3 rounded-lg cursor-pointer hover:bg-black/5 mb-2 ${THEMES[theme].bg}`}>Page {b.page}</div>
          ))}
          {sidebarTab === 'notes' && (
            <div className="space-y-4">
              {notes.filter(n => n.file === pdfFile).map(n => (
                <div key={n.id} className={`p-4 rounded-lg ${THEMES[theme].bg} border-l-4 border-blue-500`}>
                  <div className="flex justify-between text-[10px] mb-1 font-bold"><span>PAGE {n.page}</span><button onClick={() => setNotes(notes.filter(x => x.id !== n.id))}><Trash2 size={12}/></button></div>
                  <p className="text-sm italic">"{n.content}"</p>
                </div>
              ))}
              <button onClick={() => { const v = prompt("Note:"); if(v) setNotes([...notes, { id: Date.now(), page: currentPage, file: pdfFile, content: v }]); }} className="w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Add Note</button>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className={`h-16 flex items-center justify-between px-6 border-b border-gray-500/10 ${THEMES[theme].secondary} z-40 shrink-0`}>
        <div className="flex items-center gap-4">
          <button onClick={() => { setPdfDoc(null); loadLib(); }} className="p-2 hover:bg-black/5 rounded-full"><Home size={20} /></button>
          {pdfDoc && <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-black/5 rounded-full"><List size={20} /></button>}
          <div className="flex items-center gap-2"><BookOpen size={20} className="text-blue-500" /><h1 className="text-sm font-bold truncate max-w-[120px]">{pdfDoc ? library.find(b => b.id === pdfFile)?.name : 'My Library'}</h1></div>
        </div>
        <div className="flex items-center gap-2">
          {pdfDoc && (
            <div className="flex items-center gap-1 mr-2 bg-black/5 p-1 rounded-xl">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="p-1 px-3 hover:bg-white hover:shadow-sm rounded-lg text-xs font-bold transition-all">-</button>
              <span className="text-[10px] opacity-60 w-12 text-center font-mono font-bold">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(4, s + 0.2))} className="p-1 px-3 hover:bg-white hover:shadow-sm rounded-lg text-xs font-bold transition-all">+</button>
            </div>
          )}
          <div className="flex bg-black/5 p-1 rounded-xl">
            {['light', 'sepia', 'dark'].map(t => (
              <button key={t} onClick={() => setTheme(t)} className={`p-1.5 rounded-lg transition-all ${theme === t ? 'bg-white shadow-sm' : 'opacity-30'}`}>
                {t === 'light' ? <Sun size={14} /> : t === 'sepia' ? <Type size={14} /> : <Moon size={14} />}
              </button>
            ))}
          </div>
          {!pdfDoc ? (
            <button onClick={() => fileInputRef.current.click()} className="px-4 py-2 bg-blue-600 text-white rounded-full text-xs font-bold"><FileUp size={14} className="inline mr-1"/> IMPORT</button>
          ) : (
            <button onClick={() => { const exists = bookmarks.find(b => b.page === currentPage && b.file === pdfFile); if(exists) setBookmarks(bookmarks.filter(b => b.id !== exists.id)); else setBookmarks([...bookmarks, { id: Date.now(), page: currentPage, file: pdfFile }]); }} className={`p-2 ${bookmarks.some(b => b.page === currentPage && b.file === pdfFile) ? 'text-red-500' : 'opacity-30'}`}><Bookmark fill="currentColor" size={20} /></button>
          )}
          <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={onFile} />
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto bg-black/[0.02] relative flex justify-center items-start scroll-smooth kindle-scroller">
        {!pdfDoc ? (
          <div className="w-full max-w-5xl mt-8 px-4 direction-ltr pb-20">
            <h2 className="text-2xl font-bold mb-6 font-serif">Library</h2>
            {library.length === 0 ? <div className="text-center py-20 opacity-30 font-medium">No books found. Import a PDF to begin.</div> : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-6">
                {library.map(book => (
                  <div 
                    key={book.id} 
                    onClick={async () => { 
                      setIsLoading(true); 
                      const data = await getFile(book.id); 
                      const pdf = await pdfjsLibRef.current.getDocument({ data }).promise; 
                      setPdfDoc(pdf); 
                      setNumPages(pdf.numPages); 
                      setPdfFile(book.id); 
                      setCurrentPage(book.lastPage); 
                      setIsLoading(false); 
                    }} 
                    className={`cursor-pointer p-3 rounded-2xl border border-gray-500/10 shadow-sm hover:shadow-xl transition-all ${THEMES[theme].secondary} group`}
                  >
                    <div className="aspect-[3/4] bg-blue-500/5 rounded-xl mb-3 flex items-center justify-center overflow-hidden border border-gray-500/5 shadow-inner">
                      {book.cover ? (
                        <img src={book.cover} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={book.name} />
                      ) : (
                        <BookOpen size={32} className="opacity-20"/>
                      )}
                    </div>
                    <h3 className="text-[13px] font-bold line-clamp-2 h-9 px-1 leading-snug">{book.name}</h3>
                    <div className="mt-4 flex justify-between items-center opacity-40 text-[10px] font-bold px-1">
                       <button onClick={(e) => deleteBook(e, book.id)} className="hover:text-red-500 transition-colors"><Trash2 size={13}/></button>
                       <span>PG {book.lastPage}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="relative group w-fit h-fit flex justify-center py-8 direction-ltr">
            {/* Fixed Navigation Arrows */}
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p-1))} 
              className="fixed left-12 top-1/2 -translate-y-1/2 p-4 bg-white/90 dark:bg-black/70 backdrop-blur shadow-xl rounded-full z-30 opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 active:scale-95"
            >
              <ChevronLeft/>
            </button>
            <button 
              onClick={() => setCurrentPage(p => Math.min(numPages, p+1))} 
              className="fixed right-6 top-1/2 -translate-y-1/2 p-4 bg-white/90 dark:bg-black/70 backdrop-blur shadow-xl rounded-full z-30 opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 active:scale-95"
            >
              <ChevronRight/>
            </button>
            
            {/* Page Container */}
            <div className={`shadow-2xl rounded relative mx-auto transition-transform duration-200 ${theme === 'sepia' ? 'sepia-[0.1]' : ''}`}>
              <canvas 
                ref={canvasRef} 
                className={`block rounded shadow-inner ${theme === 'dark' ? 'invert-[0.9] hue-rotate-180 brightness-95' : ''}`} 
              />
            </div>
          </div>
        )}
      </main>

      {pdfDoc && (
        <footer className={`h-16 ${THEMES[theme].secondary} border-t border-gray-500/10 flex flex-col justify-center px-8 z-40 shrink-0`}>
          <div className="flex justify-between text-[10px] font-bold opacity-40 mb-1">
            <span><Clock size={10} className="inline mr-1"/> {Math.round((numPages - currentPage) * 1.5)}m left</span>
            <span>{currentPage} / {numPages} ({Math.round((currentPage/numPages)*100)}%)</span>
          </div>
          <div className="w-full bg-black/5 h-1.5 rounded-full relative overflow-hidden group/footer">
            <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${(currentPage/numPages)*100}%` }} />
            <input 
              type="range" 
              min="1" 
              max={numPages} 
              value={currentPage} 
              onChange={e => setCurrentPage(parseInt(e.target.value))} 
              className="absolute inset-0 opacity-0 cursor-pointer w-full z-10" 
            />
          </div>
        </footer>
      )}
      {isLoading && <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center font-bold text-white">Loading...</div>}

      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap');
        
        /* Force Left-Side Scrollbar logic */
        .kindle-scroller {
          direction: rtl; /* Moves vertical scrollbar to the left */
        }
        .direction-ltr {
          direction: ltr; /* Keeps content correctly oriented */
        }

        /* Custom Scrollbar Styling */
        ::-webkit-scrollbar {
          width: 12px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.03);
          border-right: 1px solid rgba(0,0,0,0.05);
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.15);
          border-radius: 20px;
          border: 3px solid transparent;
          background-clip: content-box;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.3);
          background-clip: content-box;
        }

        /* Ensure main area is the scroller */
        main {
          scrollbar-gutter: stable;
        }

        /* Range input reset */
        input[type=range] { -webkit-appearance: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; }
      `}} />
    </div>
  );
};

export default App;
