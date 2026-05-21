export interface DiaryRecord {
  id: string;
  createdAt: number; // millisecond timestamp
  date: string; // YYYY-MM-DD
  title: string;
  mood: string; // Emoji + Label (e.g., "😊 좋음")
  content: string;
  imageUrl?: string; // Firebase Storage URL or Local base64
  thumbnailUrl?: string; // Resized Base64 (canvas generated max 150px)
}

export interface FirebaseConnectionConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
}
