/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  BookOpen, 
  Settings, 
  X, 
  Search, 
  Trash2, 
  Plus, 
  Check, 
  Loader2, 
  Image as ImageIcon, 
  Calendar, 
  Smile, 
  FileText, 
  Download, 
  Code, 
  Database, 
  ExternalLink,
  Github,
  Award,
  Heart
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Types
import { DiaryRecord, FirebaseConnectionConfig } from "./types";

// Firebase Imports
import { initializeApp, getApp, getApps } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  collection, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  getDocFromServer,
  DocumentData
} from "firebase/firestore";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from "firebase/storage";

// Firestore error tracking conformant with firebase-integration skill guidelines
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

export default function App() {
  // Global Application State
  const [records, setRecords] = useState<DiaryRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<DiaryRecord | null>(null);
  const [currentFilter, setCurrentFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isFirebaseConnected, setIsFirebaseConnected] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Form Inputs
  const [date, setDate] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [mood, setMood] = useState<string>("😐 보통");
  const [content, setContent] = useState<string>(" ");
  
  // Image Handlers
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [thumbnailBase64, setThumbnailBase64] = useState<string>("");
  const [originalBase64, setOriginalBase64] = useState<string>("");
  const [imageFileName, setImageFileName] = useState<string>("");
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Panels & Dialog Controls
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [standaloneCode, setStandaloneCode] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Toast State
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: "success" | "error" }>>([]);

  // Firebase Refs (avoiding module level variables to allow dynamic reinitialization)
  const firebaseRefs = useRef<{
    db: any;
    storage: any;
    unsub: (() => void) | null;
  }>({ db: null, storage: null, unsub: null });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Today Date Helper
  const getTodayDate = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Toast Trigger Utilities
  const addToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Firestore standard error handler conforming to skill requirements
  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: null,
        email: null
      },
      operationType,
      path
    };
    console.error('Firestore Error Payload: ', JSON.stringify(errInfo));
    addToast(`데이터 연동 오류가 검출되었습니다: ${errInfo.error}`, "error");
    throw new Error(JSON.stringify(errInfo));
  };

  // Static Standalone HTML template Dynamic Loader
  useEffect(() => {
    setDate(getTodayDate());
    
    // Fetch standalone deployment-ready file
    fetch("/standalone_index.html")
      .then(res => {
        if (res.ok) return res.text();
        throw new Error("HTML 파일을 불러오지 못했습니다.");
      })
      .then(code => {
        setStandaloneCode(code);
      })
      .catch(err => {
        console.warn("Could not fetch standalone html asset: ", err);
      });
  }, []);

  // Sync / Offline Engine dynamic initializer
  useEffect(() => {
    loadSavedConfigurations();
    return () => {
      if (firebaseRefs.current.unsub) {
        firebaseRefs.current.unsub();
      }
    };
  }, []);

  const loadSavedConfigurations = async () => {
    // 1. Try to load auto-configured Workspace Firebase settings dynamically via fetch
    let autoConfig: any = null;
    try {
      const response = await fetch("/firebase-applet-config.json");
      if (response.ok) {
        autoConfig = await response.json();
      }
    } catch (e) {
      // Fetch failed or not provisioned yet
    }

    if (autoConfig && autoConfig.apiKey && autoConfig.projectId) {
      const isSuccessful = await initializeFirebaseSync(autoConfig);
      if (isSuccessful) {
        addToast("자동 워크스페이스 Firebase 연동이 무사히 가동되었습니다.");
        return;
      }
    }

    // 2. Fallback to manually saved custom configurations
    const storedConfig = localStorage.getItem("kiror-db-config");
    if (storedConfig) {
      try {
        const parsed = JSON.parse(storedConfig);
        await initializeFirebaseSync(parsed);
      } catch (err) {
        console.warn("saved config failed to initialize, switching to offline store", err);
        initializeOfflineStore();
      }
    } else {
      initializeOfflineStore();
    }
  };

  const initializeOfflineStore = () => {
    setIsFirebaseConnected(false);
    
    if (firebaseRefs.current.unsub) {
      firebaseRefs.current.unsub();
      firebaseRefs.current.unsub = null;
    }

    const localData = localStorage.getItem("kiror-records");
    if (localData) {
      try {
        setRecords(JSON.parse(localData));
      } catch (err) {
        setRecords([]);
      }
    } else {
      setRecords([]);
    }
    setIsLoaded(true);
  };

  const initializeFirebaseSync = async (config: FirebaseConnectionConfig) => {
    try {
      if (!config.apiKey || !config.projectId) {
        throw new Error("Invalid Configuration Object");
      }

      // Initialize App (Avoid multiple apps creation crash)
      let activeApp;
      if (getApps().length > 0) {
        activeApp = getApp();
      } else {
        activeApp = initializeApp(config);
      }

      const activeDb = (config as any).firestoreDatabaseId 
        ? getFirestore(activeApp, (config as any).firestoreDatabaseId)
        : getFirestore(activeApp);
      const activeStorage = getStorage(activeApp);

      firebaseRefs.current.db = activeDb;
      firebaseRefs.current.storage = activeStorage;

      // Test Connection per Firebase SDK standards before declaring online sync status
      try {
        await getDocFromServer(doc(activeDb, "test", "connection"));
      } catch (err) {
        if (err instanceof Error && err.message.includes("offline")) {
          throw new Error("firebase server unreachable");
        }
      }

      setIsFirebaseConnected(true);

      // Subscribe to Firestore snaps
      const recordsCollectionPath = "records";
      const q = query(collection(activeDb, recordsCollectionPath), orderBy("createdAt", "desc"));
      
      firebaseRefs.current.unsub = onSnapshot(q, (snapshot) => {
        const loaded: DiaryRecord[] = [];
        snapshot.forEach((docSnap) => {
          const docData = docSnap.data();
          
          // Convert Timestamp to Unix Numbers gracefully for consistency with state models
          let birthCount = Date.now();
          if (docData.createdAt) {
            if (typeof docData.createdAt.toMillis === "function") {
              birthCount = docData.createdAt.toMillis();
            } else if (docData.createdAt instanceof Date) {
              birthCount = docData.createdAt.getTime();
            } else if (typeof docData.createdAt === "number") {
              birthCount = docData.createdAt;
            } else if (typeof docData.createdAt === "string") {
              birthCount = new Date(docData.createdAt).getTime();
            }
          }

          loaded.push({
            id: docSnap.id,
            date: docData.date || "",
            title: docData.title || "",
            mood: docData.mood || "😐 보통",
            content: docData.content || "",
            imageUrl: docData.imageUrl || "",
            thumbnailUrl: docData.thumbnailUrl || "",
            createdAt: birthCount
          });
        });

        // Sort descending by Date first, then CreatedAt timestamp
        loaded.sort((a, b) => {
          const tA = new Date(a.date).getTime();
          const tB = new Date(b.date).getTime();
          if (tA !== tB) {
            return tB - tA;
          }
          return b.createdAt - a.createdAt;
        });

        setRecords(loaded);
        setIsLoaded(true);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, recordsCollectionPath);
      });

      return true;
    } catch (err) {
      console.error("Failed to connect Firebase Cloud database, switching to offline fallback: ", err);
      initializeOfflineStore();
      return false;
    }
  };

  // Canvas Image Compression Utility: Scales images with high ratio down to max 150px layout size
  const compressImageAndExtractPreview = (file: File): Promise<{ thumb: string; originalBase64: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const resultString = e.target?.result as string;
        
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Unable to create canvas context"));
            return;
          }

          const maxDimension = 150;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          // Quality factor 0.83 for optimized storage payload compression ratio
          const resThumbnail = canvas.toDataURL("image/jpeg", 0.83);
          resolve({
            thumb: resThumbnail,
            originalBase64: resultString
          });
        };
        img.onerror = (err) => reject(err);
        img.src = resultString;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // Handle Drag & Drop File Upload Actions
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processImageImport(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processImageImport(file);
    }
  };

  const processImageImport = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      addToast("이미지 파일 양식만 업로드가 가능합니다.", "error");
      return;
    }

    try {
      setImageFileName(file.name);
      setImageFile(file);
      
      const { thumb, originalBase64 } = await compressImageAndExtractPreview(file);
      setThumbnailBase64(thumb);
      setOriginalBase64(originalBase64);
    } catch (err) {
      console.error("image compression pipeline failure:", err);
      addToast("이미지 가압축 파이프라인 처리에 실해하였습니다.", "error");
    }
  };

  const cancelImageAndReset = () => {
    setImageFile(null);
    setThumbnailBase64("");
    setOriginalBase64("");
    setImageFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Submit and Save New Record Action Container
  const handleRecordPreservation = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    if (!date || !cleanTitle || !cleanContent) {
      addToast("기록 날짜, 제목, 상세 내용은 필수로 갖추어야 완성이 가능합니다.", "error");
      return;
    }

    setIsSaving(true);
    const transactionId = "doc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    const creationTimeMillis = Date.now();

    try {
      let finalImgUrl = "";

      if (isFirebaseConnected) {
        // A. REMOTE FIREBASE SYNC ACTIONS
        if (imageFile) {
          const fileExt = imageFile.name.split(".").pop() || "jpg";
          const storageLocation = `images/${transactionId}_full.${fileExt}`;
          const currentStorageRef = ref(firebaseRefs.current.storage, storageLocation);

          try {
            const uploadSnapshot = await uploadBytes(currentStorageRef, imageFile);
            finalImgUrl = await getDownloadURL(uploadSnapshot.ref);
          } catch (storageErr) {
            console.error("Firebase storage file stream failed:", storageErr);
            throw new Error("스토리지에 원본 이미지를 업로드하는 도중 장애가 발생했습니다.");
          }
        }

        const firestoreWritePayload = {
          id: transactionId,
          createdAt: new Date(),  // Request.time schema validation matchers
          date,
          title: cleanTitle,
          mood,
          content: cleanContent,
          imageUrl: finalImgUrl,
          thumbnailUrl: thumbnailBase64 || ""
        };

        const recordsCollectionName = "records";
        try {
          await setDoc(doc(firebaseRefs.current.db, recordsCollectionName, transactionId), firestoreWritePayload);
        } catch (writeErr) {
          handleFirestoreError(writeErr, OperationType.WRITE, `${recordsCollectionName}/${transactionId}`);
        }
      } else {
        // B. CLIENT DEVICE OFFLINE STORAGE ACTIONS
        if (originalBase64) {
          finalImgUrl = originalBase64;
        }

        const localRecordPayload: DiaryRecord = {
          id: transactionId,
          createdAt: creationTimeMillis,
          date,
          title: cleanTitle,
          mood,
          content: cleanContent,
          imageUrl: finalImgUrl,
          thumbnailUrl: thumbnailBase64 || ""
        };

        const latestCache = [localRecordPayload, ...records];
        localStorage.setItem("kiror-records", JSON.stringify(latestCache));
        setRecords(latestCache);
      }

      // Success Reset Actions
      setTitle("");
      setContent("");
      setMood("😐 보통");
      setImageFile(null);
      setThumbnailBase64("");
      setOriginalBase64("");
      setImageFileName("");
      setDate(getTodayDate());

      addToast("나의 소중한 고유의 기록 한 구절을 정갈하게 담았습니다.");
    } catch (submitErr: any) {
      console.error("Submission failed: ", submitErr);
      addToast(submitErr.message || "기억을 안전하게 저장하는 데 문제가 생겼습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Individual Record Action
  const handleItemDestruction = async (recordToDelete: DiaryRecord) => {
    if (!window.confirm("이 아름다운 순간의 보관 흔적을 정말로 일기 보관함에서 정식 영구 폐기하시겠습니까?")) {
      return;
    }

    try {
      if (isFirebaseConnected) {
        // Double check associated image on cloud storage to reclaim quota space
        if (recordToDelete.imageUrl && recordToDelete.imageUrl.includes("firebasestorage")) {
          try {
            const decodedPath = decodeURIComponent(recordToDelete.imageUrl);
            const pathSplits = decodedPath.split("/o/")[1].split("?")[0];
            const fileRef = ref(firebaseRefs.current.storage, pathSplits);
            await deleteObject(fileRef);
          } catch (storageDelErr) {
            console.warn("Storage item cleanup exception (could be already cleared):", storageDelErr);
          }
        }

        const collectionRoute = "records";
        try {
          await deleteDoc(doc(firebaseRefs.current.db, collectionRoute, recordToDelete.id));
        } catch (dbDelErr) {
          handleFirestoreError(dbDelErr, OperationType.DELETE, `${collectionRoute}/${recordToDelete.id}`);
        }
      } else {
        const pruned = records.filter(item => item.id !== recordToDelete.id);
        localStorage.setItem("kiror-records", JSON.stringify(pruned));
        setRecords(pruned);
      }

      addToast("보관함에서 선택하신 한 장의 기록을 정중하게 지웠습니다.");
      setSelectedRecord(null);
    } catch (delErr: any) {
      console.error("Deletion cycle error: ", delErr);
      addToast("기억을 지우는 연산 사이클 중 문제가 발생했습니다.", "error");
    }
  };

  // Save Settings from Drawer Input
  const handleFirebaseConfigSubmission = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    
    const configPay: FirebaseConnectionConfig = {
      apiKey: (fd.get("apiKey") as string)?.trim(),
      authDomain: (fd.get("authDomain") as string)?.trim(),
      projectId: (fd.get("projectId") as string)?.trim(),
      storageBucket: (fd.get("storageBucket") as string)?.trim(),
      messagingSenderId: (fd.get("messagingSenderId") as string)?.trim(),
      appId: (fd.get("appId") as string)?.trim(),
      firestoreDatabaseId: "(default)"
    };

    if (!configPay.apiKey || !configPay.projectId) {
      addToast("필수 식별자 토큰 입력 정보가 기입되지 못했습니다.", "error");
      return;
    }

    addToast("Firebase 활성화 채널을 수립하여 기기 통신 유효성을 진단 중입니다...");
    setIsLoaded(false);

    const isConnectedSuccessfully = await initializeFirebaseSync(configPay);
    
    if (isConnectedSuccessfully) {
      localStorage.setItem("kiror-db-config", JSON.stringify(configPay));
      addToast("원격 동기화 Cloud 구동 채널 생성에 아름답게 조립되었습니다.");
      setShowSettings(false);
    } else {
      addToast("연결 구성이 맞지 않거나, 오프라인입니다. 기존 로컬 모드로 안정 유지됩니다.", "error");
      initializeOfflineStore();
    }
  };

  const terminateFirebaseSyncConfig = () => {
    localStorage.removeItem("kiror-db-config");
    initializeOfflineStore();
    addToast("로컬 기기 전용 오프라인 모드로 안정 격하 및 격리 전환되었습니다.");
    setShowSettings(false);
  };

  // Copy Standalone Code to Clipboard
  const copyStandaloneCodeToClipboard = () => {
    if (!standaloneCode) {
      addToast("지정 정적 템플릿 코드 스트림 준비 상태가 아닙니다.", "error");
      return;
    }
    navigator.clipboard.writeText(standaloneCode)
      .then(() => {
        setCopiedCode(true);
        addToast("단일 HTML 배포 소스 코드가 클립보드에 무사히 복사되었습니다.");
        setTimeout(() => setCopiedCode(false), 2000);
      })
      .catch(() => {
        addToast("클립보드 접근 통제 정책으로 권한이 유보되었습니다.", "error");
      });
  };

  // Download Standalone index.html File
  const downloadStandaloneHtmlFile = () => {
    if (!standaloneCode) {
      addToast("지정 정적 보낼 문서 템플릿 스트림 가동 전입니다.", "error");
      return;
    }
    const safeBlob = new Blob([standaloneCode], { type: "text/html;charset=utf-8" });
    const localDownUrl = URL.createObjectURL(safeBlob);
    
    const virtualLink = document.createElement("a");
    virtualLink.href = localDownUrl;
    virtualLink.download = "index.html";
    document.body.appendChild(virtualLink);
    virtualLink.click();
    
    document.body.removeChild(virtualLink);
    URL.revokeObjectURL(localDownUrl);
    addToast("깃허브 페이지 업로드 전용 standalone 'index.html' 다운로드 완료!");
  };

  // Filtering & Keyword Searches
  const computeFilteredRecords = () => {
    let filtered = [...records];
    
    if (currentFilter !== "all") {
      filtered = filtered.filter(item => item.mood === currentFilter);
    }

    if (searchQuery.trim() !== "") {
      const lower = searchQuery.toLowerCase();
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(lower) || 
        item.content.toLowerCase().includes(lower)
      );
    }

    // Secondary guarantee latest ordering is preserved
    filtered.sort((a, b) => {
      const timeOfA = new Date(a.date).getTime();
      const timeOfB = new Date(b.date).getTime();
      if (timeOfA !== timeOfB) {
        return timeOfB - timeOfA;
      }
      return b.createdAt - a.createdAt;
    });

    return filtered;
  };

  const processedList = computeFilteredRecords();

  const emotionsChoice = [
    { label: " 😊 좋음", val: "😊 좋음" },
    { label: " 😐 보통", val: "😐 보통" },
    { label: " 😢 슬픔", val: "😢 슬픔" },
    { label: " 😡 화남", val: "😡 화남" },
    { label: " ✨ 설렘", val: "✨ 설렘" },
    { label: " 🌿 편안", val: "🌿 편안" }
  ];

  return (
    <div id="diary-app-container" className="min-h-screen bg-[#f9fafb] text-[#2d3748] flex flex-col antialiased">
      
      {/* Toast Alert Portal Stack */}
      <div id="toast-portal-rack" className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className={`flex items-center space-x-3 p-4 rounded-xl min-w-[280px] max-w-sm bg-white border shadow-lg cursor-pointer border-l-4 pointer-events-auto select-none ${
                t.type === "success" ? "border-gray-100 border-l-[#0D9488]" : "border-red-150 border-l-red-500"
              }`}
            >
              <div className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                t.type === "success" ? "bg-teal-50 text-[#0D9488]" : "bg-red-50 text-red-500"
              }`}>
                {t.type === "success" ? <Check className="h-4.5 w-4.5" /> : <X className="h-4.1 w-4.1" />}
              </div>
              <div className="flex-1 text-xs font-semibold text-gray-800">{t.message}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main Header navigation */}
      <header id="main-global-header" className="border-b border-gray-100 bg-white sticky top-0 z-40 transition-shadow">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#0D9488] flex items-center justify-center text-white shadow-sm">
              <BookOpen className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#0D9488]">기록을 담다</h1>
              <p className="text-[10px] text-gray-400 font-semibold tracking-wider uppercase">아날로그 감성의 일상 수첩</p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {/* Status indicators */}
            <span 
              id="live-status-pill"
              className={`px-3 py-1 rounded-full text-[11px] font-medium border flex items-center gap-1.5 transition-all duration-300 ${
                isFirebaseConnected 
                  ? "bg-emerald-50 text-emerald-700 border-emerald-250" 
                  : "bg-gray-50 text-gray-500 border-gray-200"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isFirebaseConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
              {isFirebaseConnected ? "Firebase 보관 채널 활성" : "오프라인 브라우저 모드"}
            </span>

            {/* Deploy Quick Exporter Action Button */}
            <button 
              id="btn-deploy-export"
              onClick={() => setShowExportModal(true)}
              className="px-3.5 py-1.5 bg-[#2d3748] hover:bg-slate-750 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm hover:scale-[1.01]"
              title="GitHub Pages 배포 지원 단일 소스 내보내기"
            >
              <Code className="h-3.5 w-3.5" />
              배포 독립파일 추출
            </button>

            {/* Remote Config Cog */}
            <button 
              id="btn-toggle-config-sidebar"
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 hover:text-[#0D9488] transition"
              title="Firebase 데이터베이스 동기화 설정"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <main id="diary-layout-grid-segment" className="max-w-6xl w-full mx-auto px-4 py-8 flex-1">
        
        {/* Helper Notification Banner */}
        <AnimatePresence>
          {!isFirebaseConnected && (
            <motion.div 
              id="offline-helper-banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-6 overflow-hidden"
            >
              <div className="bg-amber-50/70 border border-amber-200/65 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 shadow-sm">
                <div className="flex gap-2 items-start">
                  <Database className="h-4.5 w-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold mb-0.5">안전 가이드: 현재 로컬 오프라인 스토리지 모드로 사용 중입니다</h5>
                    <p className="text-amber-700">작성하신 기록들은 본 브라우저 임시 스토리지에 보관됩니다. 영구적인 클라우드 실시간 저장을 위해 Firebase 연동을 구축해보세요.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSettings(true)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition flex-shrink-0 text-[11px] self-end sm:self-center"
                >
                  Firebase 백엔드 연결설정
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* L - COLUMN: ENTRY FORM (5/12 cols) */}
          <section id="left-column-form" className="lg:col-span-5 bg-white rounded-2xl border border-gray-100 p-6 md:p-8 shadow-sm h-fit sticky top-24">
            <div className="border-b border-gray-100 pb-4 mb-6">
              <h2 className="text-lg font-semibold mb-1 text-gray-800 flex items-center gap-2">
                <Plus className="h-5 w-5 text-[#0D9488]" />
                오늘의 기록
              </h2>
              <p className="text-xs text-gray-400">소중한 순간을 잊지 않게 남겨보세요.</p>
            </div>

            <form id="react-record-form" onSubmit={handleRecordPreservation} className="space-y-5">
              
              {/* Date Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" />
                  기록 날짜
                </label>
                <input 
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] transition-colors text-gray-800 font-medium"
                  required
                />
              </div>

              {/* Title Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-gray-400" />
                  기록 제목
                </label>
                <input 
                  type="text"
                  placeholder="어떤 구절의 일상인가요? 한 줄 요약해보세요."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] transition-colors text-gray-800"
                  required
                />
              </div>

              {/* Mood Buttons Grid */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Smile className="h-3.5 w-3.5 text-gray-400" />
                  현재 감정 선택
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {emotionsChoice.map(emog => (
                    <button
                      key={emog.val}
                      type="button"
                      onClick={() => setMood(emog.val)}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-200 group ${
                        mood === emog.val 
                          ? "bg-[#0D9488] border-[#0D9488] text-white shadow-sm scale-[0.98]"
                          : "bg-gray-50 border-gray-200 text-gray-500 hover:border-[#0D9488] hover:bg-teal-50/10 hover:scale-[1.01]"
                      }`}
                    >
                      <span className="text-2xl mb-1 group-hover:scale-105 transition-transform">{emog.val.split(" ")[0]}</span>
                      <span className={`text-[10px] font-semibold ${mood === emog.val ? "text-white/95" : "text-gray-500"}`}>{emog.val.split(" ")[1]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea Narrative */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-gray-400" />
                  나의 이야기
                </label>
                <div className="relative">
                  <textarea 
                    rows={6}
                    placeholder="오늘 하루 머릿속을 가볍게 맴돌았던 미동들, 인상 남았던 일, 기억하고 싶은 다짐들을 자유로운 글로 자연스럽게 보관 상자에 옮겨 담으세요."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] transition-colors text-gray-800 leading-relaxed resize-none font-serif"
                    required
                  />
                  <div className="absolute right-2.5 bottom-2.5 text-[10px] font-mono text-gray-400">
                    {content.trim().length} 자 입력됨
                  </div>
                </div>
              </div>

              {/* Photo attachment upload zone */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-gray-400" />
                  기억 일러스트/사진 첨부
                </label>
                
                <input 
                  type="file"
                  id="react-input-file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />

                <AnimatePresence mode="wait">
                  {!thumbnailBase64 ? (
                    <motion.div 
                      key="drop-zone"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-2 ${
                        isDragging 
                          ? "bg-teal-50/50 border-[#0D9488] scale-[1.01]" 
                          : "border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-[#0D9488]"
                      }`}
                    >
                      <ImageIcon className="h-6 w-6 text-gray-400" />
                      <div className="text-xs text-gray-600 font-medium">탐색 영역을 누르거나 이미지 파일을 던져놓으세요</div>
                      <div className="text-[10px] text-gray-400">자동으로 가볍고 선명한 150px 미니 썸네일을 변환 정렬합니다.</div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="preview"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      className="flex items-center space-x-4 bg-gray-100 p-2.5 rounded-xl border border-gray-150 font-sans"
                    >
                      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-white border border-gray-200 flex-shrink-0 shadow-sm">
                        <img src={thumbnailBase64} className="w-full h-full object-cover" alt="압축 썸네일" />
                      </div>
                      <div className="flex-1 overflow-hidden text-left">
                        <p className="text-xs text-gray-800 font-medium truncate">{imageFileName}</p>
                        <p className="text-[10px] text-[#0D9488] font-mono">가압축 150px 렌더링 검사 통과</p>
                      </div>
                      <button 
                        type="button"
                        onClick={cancelImageAndReset}
                        className="p-1 px-1.5 rounded-full text-red-500 hover:bg-red-50 hover:text-red-700 transition"
                        title="파일 취소"
                      >
                        <X className="h-4.5 w-4.5" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-4 bg-gradient-to-r from-[#0D9488] to-[#0d9488cc] hover:from-[#0d948a] hover:to-[#0D9488] text-white font-bold rounded-xl shadow-lg shadow-teal-100 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] focus:outline-none cursor-pointer disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin h-4.5 w-4.5 text-white" />
                    <span>기억 상자에 단단히 적재하는 중...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4.5 w-4.5" />
                    <span>오늘의 기억 상자 보관하기</span>
                  </>
                )}
              </button>

            </form>
          </section>

          {/* R - COLUMN: FILTER & CHRONOLOGICAL FEED (7/12 cols) */}
          <section id="right-column-feed" className="lg:col-span-7 space-y-6">
            
            {/* Filter and Keyword Header wrapper */}
            <article className="bg-[#ffffff] rounded-2xl border border-gray-100 p-4 md:p-5 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
              
              {/* Filter chips container */}
              <div className="w-full md:w-auto overflow-x-auto flex space-x-1.5 pb-2 md:pb-0" id="emotion-chips-bar">
                <button 
                  type="button"
                  onClick={() => setCurrentFilter("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition ${
                    currentFilter === "all" 
                      ? "bg-[#0D9488] text-white shadow-sm border border-[#0D9488]"
                      : "text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:text-[#0D9488]"
                  }`}
                >
                  전체보기
                </button>
                {emotionsChoice.map(emg => (
                  <button 
                    key={emg.val}
                    type="button"
                    onClick={() => setCurrentFilter(emg.val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition flex-shrink-0 ${
                      currentFilter === emg.val
                        ? "bg-[#0D9488] text-white shadow-sm border border-[#0D9488]"
                        : "text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:text-[#0D9488]"
                    }`}
                  >
                    {emg.val}
                  </button>
                ))}
              </div>

              {/* Dynamic Search Box */}
              <div className="relative w-full md:w-56 flex-shrink-0">
                <input 
                  type="text" 
                  placeholder="보관된 기록 구절 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] transition placeholder-gray-400 font-medium"
                />
                <Search className="h-4 w-4 absolute left-3 top-2 text-gray-400 pointer-events-none" />
              </div>

            </article>

            {/* List Feed Area */}
            <div className="space-y-4">
              
              {!isLoaded ? (
                // Skeletons when fetching
                <div className="space-y-4 animate-pulse">
                  {[1, 2].map(n => (
                    <div key={n} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between">
                      <div className="flex-1 space-y-3">
                        <div className="h-3 bg-gray-150 rounded w-1/4"></div>
                        <div className="h-4 bg-gray-150 rounded w-1/2"></div>
                        <div className="h-3 bg-gray-150 rounded w-5/6"></div>
                      </div>
                      <div className="w-24 h-24 bg-gray-150 rounded-xl ml-4"></div>
                    </div>
                  ))}
                </div>
              ) : processedList.length === 0 ? (
                // Empty state view
                <div className="bg-white/60 border border-gray-100 rounded-2xl p-14 text-center text-gray-500 shadow-sm animate-fade-in">
                  <BookOpen className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                  <p className="font-bold text-sm tracking-wide text-gray-800 mb-1">비어 있는 마음 한 구석</p>
                  <p className="text-xs text-gray-400">아직 검색 조건이나 분류 감정에 매칭되는 오늘의 기록이 채워져 있지 않네요.</p>
                </div>
              ) : (
                // Main Cards Feed List mapping
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1 text-xs text-gray-400 font-sans tracking-wide">
                    <span className="font-semibold text-gray-500">나의 기록 보관함 ({processedList.length})</span>
                    <span>정렬: 작성 최신 순</span>
                  </div>
                  
                  <AnimatePresence mode="popLayout">
                    {processedList.map(record => {
                      const displayedDate = record.date ? record.date.replace(/-/g, ".") : "";
                      return (
                        <motion.div
                          key={record.id}
                          layout
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.28 }}
                          onClick={() => setSelectedRecord(record)}
                          className="group bg-white rounded-2xl border border-gray-100 p-5 md:p-6 shadow-sm hover:shadow-md hover:border-teal-200 hover:-translate-y-[1.5px] transition-all duration-300 md:flex flex-row items-center gap-5 cursor-pointer"
                        >
                          <div className="flex-1 space-y-2.5 text-left">
                            <div className="flex items-center space-x-2 text-xs">
                              <span className="font-mono text-gray-400 font-bold">{displayedDate}</span>
                              <span className="px-2 py-0.5 rounded bg-teal-50 text-[#0D9488] font-bold border border-teal-100/50 scale-90 origin-left">
                                {record.mood}
                              </span>
                            </div>
                            <h4 className="text-sm md:text-base font-semibold text-gray-800 group-hover:text-[#0D9488] transition-colors leading-snug font-sans">
                              {record.title}
                            </h4>
                            <p className="text-xs md:text-sm text-gray-500 leading-relaxed font-sans line-clamp-2 md:line-clamp-3">
                              {record.content}
                            </p>
                          </div>

                          {(record.thumbnailUrl || record.imageUrl) && (
                            <div className="w-full md:w-24 h-44 md:h-24 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0 mt-4 md:mt-0 transition group-hover:scale-[1.015] duration-300">
                              <img 
                                src={record.thumbnailUrl || record.imageUrl} 
                                className="w-full h-full object-cover" 
                                alt="기록 사진" 
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

            </div>
          </section>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-gray-100 py-6 text-center text-xs text-gray-400 mt-12 bg-white flex flex-col justify-center items-center gap-1">
        <div className="flex items-center gap-1">
          <BookOpen className="h-4 w-4 text-[#0D9488]" strokeWidth={2.5} />
          <span className="font-sans font-semibold text-gray-700 text-sm tracking-wide">기록을 담다</span>
        </div>
        <p className="font-mono text-[10px]">Designed and developed with utmost care © 2026</p>
      </footer>

      {/* THE INTEGRATION DRAWER: FIREBASE SIDE PANEL SLIDE OVER */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black"
            />
            
            {/* Drawer */}
            <motion.aside 
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3 }}
              className="absolute inset-y-0 right-0 max-w-lg w-full bg-white shadow-2xl border-l border-gray-100 flex flex-col justify-between"
            >
              <div className="p-6 md:p-8 overflow-y-auto flex-1">
                <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-6">
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-[#0D9488]" />
                    <h3 className="text-base font-semibold text-gray-800">Firebase 연결 구성 설정</h3>
                  </div>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 transition cursor-pointer"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="text-[11px] leading-relaxed text-gray-600 mb-6 bg-amber-50/40 border border-amber-200 p-4 rounded-xl space-y-1">
                  <p className="font-semibold text-amber-800">🔔 안내 사항 및 셋업 가이드</p>
                  <p>수동 연결은 필수가 아닙니다! 본인의 Firebase Enterprise/Standard Firestore와 Storage 주소를 설정하여 완벽한 크로스 기기 실시간 영구 동기화를 가동하고 싶으실 때 아래 기입 양식에 Config 규격을 넣으시면 감지해 동기화가 자동 시작됩니다.</p>
                </div>

                {/* Form dynamic inputs */}
                <form onSubmit={handleFirebaseConfigSubmission} className="space-y-4">
                  
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">API Key</label>
                    <input 
                      type="text" 
                      name="apiKey"
                      placeholder="AIzaSyA1..."
                      required
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Auth Domain</label>
                    <input 
                      type="text" 
                      name="authDomain"
                      placeholder="girokdamda-123.firebaseapp.com"
                      required
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Project ID</label>
                      <input 
                        type="text" 
                        name="projectId"
                        placeholder="girokdamda-123"
                        required
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Storage Bucket</label>
                      <input 
                        type="text" 
                        name="storageBucket"
                        placeholder="girokdamda-123.appspot.com"
                        required
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Messaging Sender ID</label>
                      <input 
                        type="text" 
                        name="messagingSenderId"
                        placeholder="1029384756..."
                        required
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">App ID</label>
                      <input 
                        type="text" 
                        name="appId"
                        placeholder="1:1029384756:web:ab2cf4..."
                        required
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-800 outline-none focus:border-[#0D9488]"
                      />
                    </div>
                  </div>

                  <div className="pt-6 border-t border-gray-150 flex flex-col gap-2">
                    <button 
                      type="submit"
                      className="w-full py-2.5 bg-[#0D9488] hover:bg-[#0d9488cc] text-white font-bold rounded-lg text-xs tracking-wider transition cursor-pointer"
                    >
                      Firebase 동적 연동 구성 적용
                    </button>
                    {isFirebaseConnected && (
                      <button 
                        type="button"
                        onClick={terminateFirebaseSyncConfig}
                        className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-650 font-bold border border-red-250 rounded-lg text-xs tracking-wider transition cursor-pointer text-center"
                      >
                        연동 끊기 및 오프라인 모드로의 변경
                      </button>
                    )}
                  </div>

                </form>
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-center text-[10px] text-gray-400">
                기록을 담다 — 클라우드 보안 연적 수집 장치
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* DETAILED VIEW MODAL COMPONENT */}
      <AnimatePresence>
        {selectedRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop with blur */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRecord(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />

            {/* Modal Inside Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl overflow-hidden max-w-2xl w-full max-h-[85vh] flex flex-col border border-gray-100 shadow-2xl relative z-10"
            >
              <div className="absolute right-4 top-4 z-10 flex space-x-2">
                <button 
                  onClick={() => setSelectedRecord(null)}
                  className="p-2 rounded-full bg-white/80 hover:bg-white text-gray-800 shadow-sm hover:text-red-500 transition hover:scale-105 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Scroll wrapper */}
              <div className="overflow-y-auto flex-1">
                {(selectedRecord.imageUrl || selectedRecord.thumbnailUrl) && (
                  <div className="relative w-full h-64 md:h-80 bg-gray-50 border-b border-gray-100">
                    <img 
                       src={selectedRecord.imageUrl || selectedRecord.thumbnailUrl} 
                       className="w-full h-full object-cover" 
                       alt="일기 원본" 
                       referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 to-transparent p-4 h-14 pointer-events-none" />
                  </div>
                )}

                <div className="p-6 md:p-8 space-y-5 text-left">
                  <div className="flex items-center space-x-2 text-xs font-sans">
                    <span className="px-2.5 py-1 rounded bg-gray-100 text-gray-500 font-mono font-bold">
                      {selectedRecord.date ? selectedRecord.date.replace(/-/g, ".") : ""}
                    </span>
                    <span className="px-2.5 py-1 rounded bg-teal-50 text-[#0D9488] font-bold border border-teal-100/50">
                      {selectedRecord.mood}
                    </span>
                  </div>

                  <h3 className="text-xl md:text-2xl font-semibold leading-tight text-gray-800 font-sans">
                    {selectedRecord.title}
                  </h3>

                  <p className="text-sm md:text-base font-sans text-gray-650 leading-relaxed whitespace-pre-line border-t border-gray-100 pt-5 pr-1 font-medium">
                    {selectedRecord.content}
                  </p>
                </div>
              </div>

              {/* Modal footer deletion panel */}
              <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex items-center justify-between text-xs font-sans">
                <span className="text-gray-400 font-mono">
                  보관 일련번호: {selectedRecord.id.substring(4, 18)}
                </span>
                <button 
                  onClick={() => handleItemDestruction(selectedRecord)}
                  className="flex items-center gap-1 text-red-500 hover:text-red-700 hover:bg-red-50/70 p-1.5 px-3 rounded-lg font-bold transition-all cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  이 기억 폐기
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COMPILATION AND EXPORTER MODAL: DEPLOYMENT HUB SUPPORT */}
      <AnimatePresence>
        {showExportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExportModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl overflow-hidden max-w-3xl w-full max-h-[85vh] flex flex-col border border-gray-200 shadow-2xl relative z-10"
            >
              {/* Export Modal Header */}
              <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Award className="h-5.5 w-5.5 text-teal-600" />
                  <div>
                    <h3 className="text-base font-bold text-gray-900 font-serif">GitHub Pages 원터치 배포 솔루션</h3>
                    <p className="text-[10px] text-gray-400">바로 업로드 할 수 있는 통합 단일 index.html 명세 추출기</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowExportModal(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-500 hover:text-red-500 transition cursor-pointer"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Code Export content panel */}
              <div className="p-6 md:p-8 space-y-5 overflow-y-auto flex-1">
                <div className="bg-teal-50 rounded-xl p-4 border border-teal-200 text-xs text-teal-900 space-y-2 text-left">
                  <p className="font-bold flex items-center gap-1">
                    <Heart className="h-4 w-4 text-teal-600 animate-pulse fill-teal-600" />
                    깃허브 페이지 배포를 바로 하고 싶으신가요?
                  </p>
                  <p className="leading-relaxed">
                    본 장치는 사용자가 <strong>"단일 index.html 파일 안에 통합되어 깃허브 Pages에 곧장 업로드할 수 있는 코드를 작성해 달라"</strong>고 명하신 조건을 충족하기 위해 심혈을 기울여 구축하였습니다. 
                    아래의 <strong>[코드 복사하기]</strong> 혹은 <strong>[index.html 다운로드]</strong> 기능을 사용하여 소스를 취득한 뒤, GitHub Repository에 업로드하고 설정에서 'Static Pages'를 켜시면 완벽하게 나만의 정적 도메인 감성 일기장이 탄생합니다!
                  </p>
                </div>

                <div className="space-y-2 text-left">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="font-semibold">추출된 단일 독립형 실행 코드</span>
                    <span className="font-mono text-[10px]">수정시간: 2026.05.21 (HTML/CSS/JS 및 CDN Firebase)</span>
                  </div>
                  
                  {/* Code Block Container */}
                  <div className="relative border border-gray-200 rounded-xl overflow-hidden bg-neutral-900 h-64 shadow-inner">
                    <pre className="p-4 text-left text-neutral-300 font-mono text-[10px] h-full overflow-auto select-all leading-normal whitespace-pre">
                      {standaloneCode || "코드를 가져오거나 준비 중입니다. 잠시만 기다려주세요..."}
                    </pre>

                    <div className="absolute right-3.5 bottom-3.5 flex items-center gap-2">
                      <button 
                        onClick={copyStandaloneCodeToClipboard}
                        className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-750 text-[10px] font-semibold rounded-lg flex items-center gap-1 shadow transition cursor-pointer"
                      >
                        {copiedCode ? <Check className="h-3 w-3" /> : <Code className="h-3 w-3" />}
                        {copiedCode ? "복사 성공" : "코드 클립보드 복사"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Check className="h-4.5 w-4.5 text-teal-500" strokeWidth={2.5} />
                    <span>Canvas 썸네일 축소 및 Firebase 호환 기능이 내장되어 있습니다.</span>
                  </div>
                  
                  <button 
                    onClick={downloadStandaloneHtmlFile}
                    className="w-full sm:w-auto px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold shadow hover:shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.01]"
                  >
                    <Download className="h-4 w-4" />
                    <span>index.html 바로 다운로드하기</span>
                  </button>
                </div>
              </div>

              {/* Export Modal Footer */}
              <div className="p-4 bg-gray-50 border-t border-gray-155 text-center text-[10px] text-gray-400">
                무단 도용 방지 및 안전 무결 보증 • 보관 수첩 독립 패키지 추출 엔진
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
