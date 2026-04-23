import { useState, useEffect, useCallback, useRef, FormEvent, ChangeEvent } from "react";
import { 
  ShoppingBag, Search, X, User, ChevronRight, Star,
  Sparkles, PenLine, BookOpen, Palette, Scissors, ArrowRight,
  Facebook, Instagram, Phone, Mail, MapPin, Eye, EyeOff, ShoppingCart,
  Heart as HeartIcon, Upload, Printer, Zap, MoreVertical, Trash2, Check, Camera,
  Home, ShieldCheck, Truck, RotateCcw, Minus, Plus, Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Product } from "./constants";
import { auth, db, storage } from "./lib/firebase";
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  updateProfile
} from "firebase/auth";
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  updateDoc, 
  deleteDoc,
  getDocFromServer
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Biểu đồ đơn giản sử dụng SVG (không phụ thuộc thư viện ngoài để tránh lỗi build)
const CustomSimpleAreaChart = ({ data }: { data: { name: string, value: number }[] }) => {
  const height = 400;
  const width = 800; // Sẽ tự co giãn qua ResponsiveContainer-like div
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  
  if (!data || data.length === 0) return <div className="h-full flex items-center justify-center text-gray-400">Không có dữ liệu</div>;

  const maxValue = Math.max(...data.map(d => d.value), 1);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y };
  });

  const pathData = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
  const areaData = pathData + ` L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  return (
    <div className="w-full h-full relative overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-aspect-ratio-none">
        <defs>
          <linearGradient id="svgGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffb7c5" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#ffb7c5" stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Lưới ngang */}
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => {
          const y = padding.top + chartHeight - v * chartHeight;
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#f3f4f6" strokeWidth="1" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="text-[10px] fill-gray-400 font-bold">
                {Math.round(maxValue * v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Trục X */}
        {data.map((d, i) => {
          const x = padding.left + (i / (data.length - 1)) * chartWidth;
          return (
            <text key={i} x={x} y={height - 10} textAnchor="middle" className="text-[10px] fill-gray-400 font-bold">
              {d.name}
            </text>
          );
        })}

        {/* Vùng Area */}
        <path d={areaData} fill="url(#svgGradient)" />
        
        {/* Đường Line */}
        <path d={pathData} fill="none" stroke="#ffb7c5" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Các điểm nút */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="6" fill="white" stroke="#ffb7c5" strokeWidth="3" />
        ))}
      </svg>
    </div>
  );
};

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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const uploadImage = async (file: File, folder: string = "uploads"): Promise<string> => {
  console.log(`Starting upload to Firebase Storage ${folder}:`, file.name, file.size, file.type);
  try {
    const storageRef = ref(storage, `${folder}/${Date.now()}-${file.name}`);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log("Upload successful:", downloadURL);
    return downloadURL;
  } catch (error: any) {
    console.error("Upload Error details:", error);
    throw new Error(`Lỗi tải ảnh: ` + error.message, { cause: error });
  }
};

const cleanImageUrl = (url: string) => {
  if (!url) return "";
  const cleaned = url.trim();
  
  // Handle Google Drive links
  if (cleaned.includes("drive.google.com") || cleaned.includes("docs.google.com")) {
    const match = cleaned.match(/\/d\/([a-zA-Z0-9_-]{25,})/) || cleaned.match(/id=([a-zA-Z0-9_-]{25,})/);
    if (match && match[1]) {
      // lh3.googleusercontent.com/d/ is more reliable for direct embedding and bypassing some preview overlays
      return `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
  }
  
  // Handle Dropbox links
  if (cleaned.includes("dropbox.com")) {
    return cleaned.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "");
  }

  // Handle Imgur links
  if (cleaned.includes("imgur.com") && !cleaned.includes("i.imgur.com")) {
    const id = cleaned.split("/").pop()?.split(".")[0];
    if (id && id.length >= 5) {
      return `https://i.imgur.com/${id}.jpg`;
    }
  }

  // Handle Pinterest direct links
  if (cleaned.includes("i.pinimg.com")) {
    return cleaned.replace("/236x/", "/originals/").replace("/564x/", "/originals/");
  }

  return cleaned;
};

const DECORATION_POSITIONS = [...Array(12)].map(() => ({
  top: `${Math.random() * 100}%`,
  left: `${Math.random() * 100}%`,
  rotation: `${Math.random() * 360}deg`,
  scale: 0.5 + Math.random()
}));

const PRODUCTS: Product[] = [
  { id: 1, name: 'Bút Gel Pastel HanaChiBi - Set 5 màu', price: 45000, originalPrice: 55000, image: 'https://picsum.photos/seed/pen1/600/600', category: 'pen', subCategory: 'Bút nước', brand: 'Thiên Long', isHot: true, isFlashSale: true, soldCount: 45, totalStock: 100, rating: 5, reviews: 124, description: 'Dòng bút gel mực mượt mà, màu sắc pastel nhẹ nhàng phù hợp cho việc ghi chú và trang trí sổ tay.' },
  { id: 2, name: 'Sổ tay lò xo A5 - Pinky Dream', price: 32000, originalPrice: 45000, image: 'https://picsum.photos/seed/notebook1/600/600', category: 'notebook', subCategory: 'Sổ lò xo', brand: 'HanaChiBi', isNew: true, isFlashSale: true, soldCount: 28, totalStock: 100, rating: 4.8, reviews: 89, description: 'Sổ tay bìa cứng cán màng mờ, giấy định lượng cao chống thấm mực, thiết kế Mascot HanaChiBi độc quyền.' },
  { id: 3, name: 'Hộp bút silicon hình thú dễ thương', price: 55000, originalPrice: 65000, image: 'https://picsum.photos/seed/case1/600/600', category: 'case', subCategory: 'Hộp bút', brand: 'Flexoffice', isFlashSale: true, soldCount: 67, totalStock: 100, rating: 4.9, reviews: 210, description: 'Chất liệu silicon cao cấp, mềm mịn, dễ vệ sinh. Sức chứa lớn cho tất cả đồ dùng học tập của bạn.' },
  { id: 4, name: 'Set Sticker trang trí Bullet Journal', price: 15000, originalPrice: 25000, image: 'https://picsum.photos/seed/sticker1/600/600', category: 'sticker', subCategory: 'Set sticker', brand: 'HanaChiBi', isNew: true, isFlashSale: true, soldCount: 12, totalStock: 100, rating: 5, reviews: 56, description: 'Hơn 50 sticker cắt sẵn với nhiều chủ đề dễ thương, màu sắc tươi sáng, độ bám dính tốt.' },
  { id: 5, name: 'Bút chì kim 0.5mm - Pastel Edition', price: 12000, image: 'https://picsum.photos/seed/pencil1/600/600', category: 'pen', subCategory: 'Bút chì', brand: 'Điểm 10', rating: 4.7, reviews: 45, description: 'Thiết kế công thái học giúp cầm nắm thoải mái, ngòi chì 0.5mm chắc chắn, không dễ gãy.' },
  { id: 6, name: 'Tập 200 trang - HanaChiBi Mascot', price: 18000, image: 'https://picsum.photos/seed/notebook2/600/600', category: 'notebook', subCategory: 'Vở kẻ ngang', brand: 'HanaChiBi', isHot: true, rating: 4.9, reviews: 312, description: 'Vở kẻ ngang chất lượng cao, độ trắng tự nhiên bảo vệ mắt, bìa in hình linh vật HanaChiBi.' },
  { id: 7, name: 'Gôm tẩy hình bánh donut màu sắc', price: 8000, image: 'https://picsum.photos/seed/eraser1/600/600', category: 'tool', subCategory: 'Gôm tẩy', brand: 'Colokit', rating: 4.6, reviews: 78, description: 'Gôm tẩy sạch, không để lại bụi, hình dáng bánh donut sáng tạo và bắt mắt.' },
  { id: 8, name: 'Bút highlight 2 đầu - Soft Color', price: 25000, image: 'https://picsum.photos/seed/highlighter1/600/600', category: 'pen', subCategory: 'Bút highlight', brand: 'Thiên Long', rating: 4.8, reviews: 156, description: 'Một đầu dẹt và một đầu tròn tiện lợi, màu sắc nhẹ nhàng không gây lóa mắt khi đọc lại.' }
];

const FLASH_SALE_PRODUCTS = PRODUCTS.filter(p => p.isFlashSale);

interface CartItem {
  product: Product;
  quantity: number;
  selectedOptions?: Record<string, string>;
}

export default function App() {
  // HanaChiBi Stationery - Local Server Version (Updated)
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSubCategory, setSelectedSubCategory] = useState("all");
  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [hasLoadedProducts, setHasLoadedProducts] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedCartItems, setSelectedCartItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [quickViewOptions, setQuickViewOptions] = useState<Record<string, string>>({});
  const [quickViewQuantity, setQuickViewQuantity] = useState(1);
  const [selectedQuickViewImage, setSelectedQuickViewImage] = useState<string | null>(null);
  const [productPage, setProductPage] = useState<Product | null>(null);
  const [productPageQuantity, setProductPageQuantity] = useState(1);
  const [productPageOptions, setProductPageOptions] = useState<Record<string, string>>({});
  const [productPageImageIndex, setProductPageImageIndex] = useState(0);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [showCart, setShowCart] = useState(() => localStorage.getItem('hanachibi_show_cart') === 'true');
  const [showCheckout, setShowCheckout] = useState(() => localStorage.getItem('hanachibi_show_checkout') === 'true');
  const [showLogin, setShowLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const [isAdminView, setIsAdminView] = useState(() => localStorage.getItem('hanachibi_admin_view') === 'true');
  const [isUploading, setIsUploading] = useState(false);

  const toggleAdminView = (val: boolean) => {
    setIsAdminView(val);
    localStorage.setItem('hanachibi_admin_view', String(val));
  };
  const [adminTab, setAdminTab] = useState<'orders' | 'products' | 'categories' | 'settings' | 'stats'>(() => (localStorage.getItem('hanachibi_admin_tab') as any) || 'orders');
  const [adminProductSearch, setAdminProductSearch] = useState("");

  useEffect(() => {
    localStorage.setItem('hanachibi_admin_tab', adminTab);
  }, [adminTab]);
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [myOrdersTab, setMyOrdersTab] = useState("Tất cả");
  const [showOutOfStockModal, setShowOutOfStockModal] = useState<{orderId: string, productId: string} | null>(null);
  const [affectedOrders, setAffectedOrders] = useState<any[]>([]);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);
  const [comboInput, setComboInput] = useState("");
  const [orderStatus, setOrderStatus] = useState<'idle' | 'submitting' | 'success'>(() => (localStorage.getItem('hanachibi_order_status') as any) || 'idle');
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [customAlert, setCustomAlert] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);
  const [customConfirm, setCustomConfirm] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [directBuyItem, setDirectBuyItem] = useState<{product: Product, quantity: number, selectedOptions?: Record<string, string>} | null>(null);

  const showAlert = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setCustomAlert({ message, type });
  }, []);

  const showConfirm = useCallback((message: string, onConfirm: () => void) => {
    setCustomConfirm({ message, onConfirm });
  }, []);
  const [settings, setSettings] = useState({
    logo: "/logo.png",
    loginBanner: "https://picsum.photos/seed/hanachibi-main/1000/800",
    loginBannerText: "Cùng HanaChiBi viết nên ước mơ",
    mascotImage: "https://picsum.photos/seed/pink-panther/400/400",
    mascotText: "Pink panther đang đợi bạn đây nhé",
    qrCode: ""
  });
  const [showSearchTrends, setShowSearchTrends] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const trendingKeywords = ["Bút gel", "Sổ tay", "Sticker", "Washi tape", "Hộp bút"];
  const [customerInfo, setCustomerInfo] = useState({ 
    name: "", 
    phone: "", 
    province: "",
    district: "",
    ward: "",
    address: "", 
    note: "",
    voucher: "",
    paymentMethod: "cod",
    shippingMethod: "standard",
    useCoins: false
  });
  const [provinces, setProvinces] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [wards, setWards] = useState<any[]>([]);
  const [loadingLocations, setLoadingLocations] = useState({ p: false, d: false, w: false });

  useEffect(() => {
    const fetchProvinces = async () => {
      setLoadingLocations(prev => ({ ...prev, p: true }));
      try {
        const res = await fetch('https://provinces.open-api.vn/api/p/');
        const data = await res.json();
        setProvinces(data);
      } catch (err) {
        console.error("Failed to fetch provinces", err);
      } finally {
        setLoadingLocations(prev => ({ ...prev, p: false }));
      }
    };
    fetchProvinces();
  }, []);

  useEffect(() => {
    if (!customerInfo.province) {
      setDistricts([]);
      setWards([]);
      return;
    }
    const fetchDistricts = async () => {
      const p = provinces.find(p => p.name === customerInfo.province);
      if (!p) return;
      setLoadingLocations(prev => ({ ...prev, d: true }));
      try {
        const res = await fetch(`https://provinces.open-api.vn/api/p/${p.code}?depth=2`);
        const data = await res.json();
        setDistricts(data.districts || []);
      } catch (err) {
        console.error("Failed to fetch districts", err);
      } finally {
        setLoadingLocations(prev => ({ ...prev, d: false }));
      }
    };
    fetchDistricts();
  }, [customerInfo.province, provinces]);

  useEffect(() => {
    if (!customerInfo.district) {
      setWards([]);
      return;
    }
    const fetchWards = async () => {
      const d = districts.find(d => d.name === customerInfo.district);
      if (!d) return;
      setLoadingLocations(prev => ({ ...prev, w: true }));
      try {
        const res = await fetch(`https://provinces.open-api.vn/api/d/${d.code}?depth=2`);
        const data = await res.json();
        setWards(data.wards || []);
      } catch (err) {
        console.error("Failed to fetch wards", err);
      } finally {
        setLoadingLocations(prev => ({ ...prev, w: false }));
      }
    };
    fetchWards();
  }, [customerInfo.district, districts]);
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hasLoadedCart, setHasLoadedCart] = useState(false);
  const lastUserRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isAuthReady) return;

    const currentUid = user?.uid;
    const key = currentUid ? `hanachibi_cart_${currentUid}` : 'hanachibi_cart_guest';

    if (currentUid !== lastUserRef.current) {
      // User switched or initial load, load the correct cart for this user
      const saved = localStorage.getItem(key);
      setCart(saved ? JSON.parse(saved) : []);
      lastUserRef.current = currentUid;
      setHasLoadedCart(true);
    } else if (hasLoadedCart) {
      // Same user AND already loaded, so this is a valid cart update to save
      localStorage.setItem(key, JSON.stringify(cart));
    }
  }, [cart, user?.uid, isAuthReady, hasLoadedCart]);

  const [favorites, setFavorites] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('hanachibi_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('hanachibi_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (productId: number) => {
    setFavorites(prev => 
      prev.includes(productId) 
        ? prev.filter(id => id !== productId) 
        : [...prev, productId]
    );
  };

  const decorationPositions = useRef(DECORATION_POSITIONS).current;

  useEffect(() => {
    let unsubscribeDoc: (() => void) | undefined;
    
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      // Cleanup previous doc listener if it exists
      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = undefined;
      }

      if (firebaseUser) {
        // Correctly handle the potential async doc snap logic inside the listener
        unsubscribeDoc = onSnapshot(doc(db, "users", firebaseUser.uid), (docSnap) => {
          if (docSnap.exists()) {
            setUser(docSnap.data());
          } else {
            const userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || "Người dùng",
              coins: 0,
              role: (["dinhthinguyetnga.11a6hd@gmail.com", "lequan1995.ub@gmail.com"].includes(firebaseUser.email || "") ? "admin" : "user")
            };
            // Note: fire and forget the setDoc here, or handle it in a separate effect
            setDoc(doc(db, "users", firebaseUser.uid), userData).catch(err => {
              console.error("Error creating user document:", err);
            });
            setUser(userData);
          }
          setIsAuthReady(true);
        }, (error) => {
          console.error("User document subscription error:", error);
          setIsAuthReady(true);
        });
      } else {
        setUser(null);
        setIsAuthReady(true);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, []);

  useEffect(() => {
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          setConnectionError("Không thể kết nối với máy chủ Firebase. Vui lòng kiểm tra lại cấu hình.");
        }
      }
    };
    testConnection();

    // Real-time products
    const unsubProducts = onSnapshot(collection(db, "products"), (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setLiveProducts(productsData);
      setHasLoadedProducts(true);
      setConnectionError(null);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "products");
    });

    // Real-time categories
    const unsubCategories = onSnapshot(collection(db, "categories"), (snapshot) => {
      const categoriesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort categories: 'all' first, then by priority, then by name
      categoriesData.sort((a: any, b: any) => {
        if (a.id === 'all') return -1;
        if (b.id === 'all') return 1;
        if (a.priority !== b.priority) {
          return (a.priority || 0) - (b.priority || 0);
        }
        return (a.name || "").localeCompare(b.name || "");
      });
      setCategories(categoriesData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "categories");
    });

    // Real-time settings
    const unsubSettings = onSnapshot(doc(db, "settings", "global"), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        // Only update if fields are present to avoid overwriting defaults with undefined
        setSettings(prev => ({
          ...prev,
          logo: data.logo || prev.logo,
          loginBanner: data.loginBanner || prev.loginBanner,
          loginBannerText: data.loginBannerText || prev.loginBannerText,
          mascotImage: data.mascotImage || prev.mascotImage,
          mascotText: data.mascotText || prev.mascotText,
          qrCode: data.qrCode || prev.qrCode
        }));
      }
      setIsSettingsLoaded(true);
    }, (error) => {
      console.error("Error loading settings:", error);
      handleFirestoreError(error, OperationType.GET, "settings/global");
      setIsSettingsLoaded(true); // Allow UI to show even if settings fail
    });

    return () => {
      unsubProducts();
      unsubCategories();
      unsubSettings();
    };
  }, []);

  useEffect(() => {
    if (user) {
      const q = user.role === 'admin' 
        ? query(collection(db, "orders"), orderBy("createdAt", "desc"))
        : query(collection(db, "orders"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setOrders(ordersData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, "orders");
      });
      return () => unsubscribe();
    }
  }, [user]);
  const [vouchers] = useState([
    { code: "HANA10", discount: 10000, minOrder: 50000 },
    { code: "CHIBI20", discount: 20000, minOrder: 100000 },
    { code: "FREESHIP", discount: 15000, minOrder: 0 }
  ]);
  const [selectedOrderStatus, setSelectedOrderStatus] = useState("Tất cả");
  const [loginForm, setLoginForm] = useState({ email: "", password: "", name: "", confirmPassword: "" });
  const [authError, setAuthError] = useState("");
  const [timeLeft, setTimeLeft] = useState({ hours: 2, minutes: 45, seconds: 0 });
  const [adminOrderSearch, setAdminOrderSearch] = useState("");
  const [showCancelModal, setShowCancelModal] = useState<{ orderId: string, type: 'admin' | 'customer' } | null>(null);
  const [cancelStep, setCancelStep] = useState<'confirm' | 'reason' | 'products'>('confirm');
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingOrder, setCancellingOrder] = useState<any>(null);
  const [outOfStockItems, setOutOfStockItems] = useState<(string | number)[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [showAdminPasswordModal, setShowAdminPasswordModal] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState("");
  const [activeAdminMenu, setActiveAdminMenu] = useState<number | null>(null);
  const [activeStatusMenu, setActiveStatusMenu] = useState<number | null>(null);


  const handleSaveSettings = async (newSettings: any) => {
    if (!isSettingsLoaded) return;
    try {
      const cleanedSettings = {
        ...newSettings,
        logo: cleanImageUrl(newSettings.logo),
        loginBanner: cleanImageUrl(newSettings.loginBanner),
        mascotImage: cleanImageUrl(newSettings.mascotImage),
        qrCode: cleanImageUrl(newSettings.qrCode)
      };
      await setDoc(doc(db, "settings", "global"), cleanedSettings);
      setSettings(cleanedSettings);
      showAlert("Đã lưu cài đặt hệ thống thành công! ✨", "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "settings/global");
    }
  };

  const updateSettings = async (updates: Partial<typeof settings>) => {
    const nextSettings = { ...settings, ...updates };
    setSettings(nextSettings);
    await handleSaveSettings(nextSettings);
  };

  const handleUpdateUser = async (updateData: any) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid), updateData);
      setUser((prev: any) => ({ ...prev, ...updateData }));
      showAlert("Cập nhật thông tin thành công! ✨", "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleUserAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const imageUrl = await uploadImage(file, "avatars");
      handleUpdateUser({ avatar: imageUrl });
      showAlert("Cập nhật ảnh đại diện thành công! ✨", "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "avatars");
    } finally {
      setIsUploading(false);
    }
  };
   const handleSubmitReview = async () => {
    if (!user) {
      showAlert("Opps! Bạn cần đăng nhập để gửi đánh giá nhé 🐾", "info");
      setShowLogin(true);
      return;
    }

    if (!reviewComment.trim()) {
      showAlert("Vui lòng nhập cảm nhận của bạn trước khi gửi nhé! ✨", "info");
      return;
    }

    if (!productPage) return;
    
    try {
      const reviewData = {
        id: Date.now().toString(),
        userId: user.uid,
        userName: user.name || "Người dùng",
        rating: reviewRating,
        comment: reviewComment,
        images: reviewImages,
        createdAt: new Date().toISOString()
      };

      const updatedReviews = [...(productPage.reviewsList || []), reviewData];
      
      const productRef = doc(db, "products", productPage.id.toString());
      await setDoc(productRef, {
        ...productPage,
        reviewsList: updatedReviews
      }, { merge: true });

      setProductPage({...productPage, reviewsList: updatedReviews});
      
      setReviewRating(5);
      setReviewComment("");
      setReviewImages([]);
      showAlert("Cảm ơn bạn đã gửi đánh giá nhé! 🌸", "success");
    } catch (error) {
      console.error("Error submitting review:", error);
      showAlert("Có lỗi xảy ra khi gửi đánh giá. Thử lại sau nhé!", "error");
    }
  };
  const [subCategoriesInput, setSubCategoriesInput] = useState("");
  const [rawProductOptions, setRawProductOptions] = useState<string[]>([]);
  const [orderDetail, setOrderDetail] = useState<any>(null);

  useEffect(() => {
    if (productPage && !selectedQuickViewImage) {
      const timer = setInterval(() => {
        setProductPageImageIndex(prev => {
          const images = [productPage.image, ...(productPage.images || [])].filter(Boolean);
          if (images.length === 0) return 0;
          return (prev + 1) % images.length;
        });
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [productPage, selectedQuickViewImage]);

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
        showAlert("Đăng nhập thành công! ✨", "success");
      } else {
        if (loginForm.password !== loginForm.confirmPassword) {
          setAuthError("Mật khẩu xác nhận không khớp!");
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(auth, loginForm.email, loginForm.password);
        await updateProfile(userCredential.user, { displayName: loginForm.name });
        
        const userData = {
          uid: userCredential.user.uid,
          email: loginForm.email,
          name: loginForm.name,
          coins: 0,
          role: (["dinhthinguyetnga.11a6hd@gmail.com", "lequan1995.ub@gmail.com"].includes(loginForm.email) ? "admin" : "user")
        };
        await setDoc(doc(db, "users", userCredential.user.uid), userData);
        showAlert("Đăng ký thành công! ✨", "success");
      }
      setShowLogin(false);
      setLoginForm({ email: "", password: "", name: "", confirmPassword: "" });
    } catch (error: any) {
      console.error("Auth Error:", error);
      setAuthError(error.message || "Đã có lỗi xảy ra");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      toggleAdminView(false);
      setSelectedCategory("all");
      setSearchQuery("");
      setProductPage(null);
      setShowCart(false);
      setShowCheckout(false);
      setShowMyOrders(false);
      showAlert("Đã đăng xuất thành công! Hẹn gặp lại bạn nhé 🌸", "success");
    } catch (error) {
      console.error("Logout error:", error);
      showAlert("Có lỗi xảy ra khi đăng xuất", "error");
    }
  };

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();

    if (!user) {
      showAlert("Opps! Bạn cần đăng nhập để có thể đặt hàng nhé 🌸", "info");
      setShowLogin(true);
      return;
    }

    if (!customerInfo.name.trim() || !customerInfo.phone.trim() || !customerInfo.province || !customerInfo.district || !customerInfo.ward || !customerInfo.address.trim()) {
      showAlert("Vui lòng điền đầy đủ Tên, Số điện thoại và Địa chỉ (Tỉnh, Huyện, Xã, Số nhà) nhé! ✨", "info");
      return;
    }

    if (customerInfo.paymentMethod === 'bank' && !showQR) {
      setShowQR(true);
      return;
    }
    setOrderStatus('submitting');
    
    // Items to process - either the single direct-buy item or selected cart items
    const itemsToOrder = directBuyItem ? [directBuyItem] : cart.filter(item => selectedCartItems.includes(getCartItemId(item)));

    if (itemsToOrder.length === 0) {
      showAlert("Vui lòng chọn ít nhất một sản phẩm để đặt hàng!", "error");
      setOrderStatus('idle');
      return;
    }

    const cartTotal = itemsToOrder.reduce((acc, item) => acc + item.product.price * item.quantity, 0);

    const voucher = vouchers.find(v => v.code === customerInfo.voucher);
    const discount = voucher && cartTotal >= voucher.minOrder ? voucher.discount : 0;
    const shipping = customerInfo.shippingMethod === 'express' ? 35000 : 20000;
    const coinsUsed = customerInfo.useCoins ? Math.min(user?.coins || 0, cartTotal - discount + shipping) : 0;
    const finalTotal = cartTotal - discount + shipping - coinsUsed;
    const earnedCoins = Math.floor(cartTotal / 10000);

    try {
      const orderData = {
        userId: user.uid,
        customer: {
          ...customerInfo,
          fullAddress: `${customerInfo.address}, ${customerInfo.ward}, ${customerInfo.district}, ${customerInfo.province}`
        },
        items: itemsToOrder,
        total: finalTotal,
        discount,
        shipping,
        coinsUsed,
        earnedCoins,
        status: customerInfo.paymentMethod === 'bank' ? "Chờ lấy hàng" : "Chờ xác nhận",
        createdAt: new Date().toISOString()
      };

      const orderRef = doc(collection(db, "orders"));
      await setDoc(orderRef, orderData);
      
      // Update user coins
      await updateDoc(doc(db, "users", user.uid), {
        coins: (user.coins || 0) - coinsUsed + earnedCoins
      });

      setOrderStatus('success');
      
      if (directBuyItem) {
        setDirectBuyItem(null);
      } else {
        setCart(prev => prev.filter(item => !selectedCartItems.includes(getCartItemId(item))));
        setSelectedCartItems([]);
      }

      setShowQR(false);
      showAlert("Đặt hàng thành công! HanaChiBi sẽ sớm liên hệ với bạn nhé 🌸", "success");
      setTimeout(() => {
        setShowCheckout(false);
        setOrderStatus('idle');
        setCustomerInfo({ 
          name: "", phone: "", 
          province: "", district: "", ward: "",
          address: "", note: "", 
          voucher: "", paymentMethod: "cod", shippingMethod: "standard", useCoins: false 
        });
      }, 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "orders");
      setOrderStatus('idle');
    }
  };

  const openZalo = () => {
    const link = document.createElement('a');
    link.href = "https://zalo.me/0123456789";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  };

  const handleCancelOrder = async () => {
    if (!showCancelModal) return;
    const { orderId, type } = showCancelModal;
    
    const updateData = {
      status: 'Đã hủy',
      cancelledBy: type === 'admin' ? 'Quản trị viên' : 'Khách hàng',
      cancelReason: cancelReason,
      outOfStockItems: cancelReason === 'Hết hàng' ? outOfStockItems : []
    };

    try {
      await updateDoc(doc(db, "orders", String(orderId)), updateData);
      setShowCancelModal(null);
      setOrderDetail(null);
      setCancelReason("");
      setOutOfStockItems([]);
      setCancelStep('confirm');
      showAlert("Đã hủy đơn hàng thành công!", "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };
  const handleAdminAccess = () => {
    if (adminPasswordInput === "hanachibi123") { // Mật khẩu mặc định
      toggleAdminView(true);
      setAdminTab('orders');
      setShowAdminPasswordModal(false);
      setAdminPasswordInput("");
      setAdminPasswordError("");
      setOrderDetail(null);
      setShowCancelModal(null);
    } else {
      setAdminPasswordError("Mật khẩu không chính xác!");
    }
  };

  const handleUpdateOrderStatus = async (orderId: number | string, updateData: any) => {
    if (user?.role !== 'admin') {
      showAlert("Bạn không có quyền thực hiện hành động này!", "error");
      return;
    }
    try {
      await updateDoc(doc(db, "orders", String(orderId)), updateData);
      showAlert("Đã cập nhật đơn hàng thành công! ✨", "success");
      setActiveStatusMenu(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };


  const handleProductImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!auth.currentUser) {
      showAlert("Vui lòng đăng nhập để tải ảnh lên!", "error");
      return;
    }

    setIsUploading(true);
    try {
      const imageUrl = await uploadImage(file, "products");
      setEditingProduct(prev => {
        if (!prev) return null;
        const images = prev.images || [];
        return { 
          ...prev, 
          image: prev.image || imageUrl, // Set as main image if none exists
          images: [...images, imageUrl] 
        };
      });
      showAlert("Tải ảnh sản phẩm thành công! ✨", "success");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, "products");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    if (user?.role !== 'admin') {
      showAlert("Bạn không có quyền thực hiện hành động này!", "error");
      return;
    }
    try {
      const productData = { ...editingProduct };
      // Ensure originalPrice can be null to clear it in Firestore
      if (productData.originalPrice === undefined) {
        productData.originalPrice = null as any;
      }
      
      if (productData.id) {
        const id = String(productData.id);
        delete productData.id;
        await updateDoc(doc(db, "products", id), productData);
      } else {
        const productRef = doc(collection(db, "products"));
        await setDoc(productRef, { ...productData, createdAt: new Date().toISOString() });
      }
      setEditingProduct(null);
      setRawProductOptions([]);
      showAlert("Đã lưu sản phẩm thành công! ✨", "success");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, "products");
    }
  };

  const handleDeleteProduct = async (id: number | string) => {
    if (user?.role !== 'admin') {
      showAlert("Bạn không có quyền thực hiện hành động này!", "error");
      return;
    }
    showConfirm("Bạn có chắc muốn xóa sản phẩm này?", async () => {
      try {
        await deleteDoc(doc(db, "products", String(id)));
        showAlert("Đã xóa sản phẩm thành công!", "success");
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
      }
    });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
        if (prev.minutes > 0) return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        if (prev.hours > 0) return { ...prev, hours: prev.hours - 1, minutes: 59, seconds: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleSaveCategory = async (categoryData: any) => {
    if (!categoryData) return;
    if (user?.role !== 'admin') {
      showAlert("Bạn không có quyền thực hiện hành động này!", "error");
      return;
    }
    try {
      const data = { ...categoryData };
      const id = data.id || `cat-${Date.now()}`;
      delete data.id;
      await setDoc(doc(db, "categories", String(id)), data);
      setEditingCategory(null);
      setSubCategoriesInput("");
      showAlert("Đã lưu danh mục thành công! ✨", "success");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, "categories");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (user?.role !== 'admin') {
      showAlert("Bạn không có quyền thực hiện hành động này!", "error");
      return;
    }
    showConfirm("Bạn có chắc muốn xóa danh mục này?", async () => {
      try {
        await deleteDoc(doc(db, "categories", id));
        if (selectedCategory === id) setSelectedCategory("all");
        showAlert("Đã xóa danh mục thành công!", "success");
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `categories/${id}`);
      }
    });
  };

  const filteredProducts = (hasLoadedProducts && liveProducts.length > 0 ? liveProducts : PRODUCTS)
    .filter(p => {
      const matchesCategory = selectedCategory === "all" || p.category === selectedCategory;
      const matchesSubCategory = selectedSubCategory === "all" || p.subCategory === selectedSubCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesBrand = selectedBrands.length === 0 || (p.brand && selectedBrands.includes(p.brand));
      const matchesPrice = !priceRange || (p.price >= priceRange[0] && p.price <= priceRange[1]);
      return matchesCategory && matchesSubCategory && matchesSearch && matchesBrand && matchesPrice;
    })
    .sort((a, b) => {
      if (sortBy === "price-asc") return a.price - b.price;
      if (sortBy === "price-desc") return b.price - a.price;
      if (sortBy === "name-asc") return a.name.localeCompare(b.name);
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      // Newest first (using createdAt or ID as fallback)
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (dateA && dateB) return dateB - dateA;
      return String(b.id).localeCompare(String(a.id));
    });

  const toggleBrand = (brand: string) => {
    setSelectedBrands(prev => 
      prev.includes(brand) ? prev.filter(b => b !== brand) : [...prev, brand]
    );
  };

  const getCartItemId = useCallback((item: {product: Product, selectedOptions?: Record<string, string>}) => {
    return `${item.product.id}-${JSON.stringify(item.selectedOptions || {})}`;
  }, []);

  const handleBuyNow = (product: Product, options?: Record<string, string>, quantity: number = 1) => {
    const minQty = product.minQuantity || 1;
    if (quantity < minQty) {
      showAlert(`Sản phẩm này cần mua tối thiểu ${minQty} cái nhé! 🌸`, "error");
      return;
    }
    setDirectBuyItem({ product, quantity, selectedOptions: options });
    if (!user) {
      setShowLogin(true);
    } else {
      setShowCart(false);
      setShowCheckout(true);
    }
  };

  const addToCart = (product: Product, options?: Record<string, string>, quantity: number = 1) => {
    const minQty = product.minQuantity || 1;
    if (quantity < minQty) {
      showAlert(`Sản phẩm này cần mua tối thiểu ${minQty} cái nhé! 🌸`, "error");
      return;
    }
    const finalQty = quantity;
    
    const newItem = { product, quantity: finalQty, selectedOptions: options };
    const newItemId = getCartItemId(newItem);
    
    setCart(prev => {
      const existing = prev.find(item => getCartItemId(item) === newItemId);
      if (existing) {
        return prev.map(item => getCartItemId(item) === newItemId ? { ...item, quantity: item.quantity + finalQty } : item);
      }
      return [...prev, newItem];
    });
    
    setSelectedCartItems(prev => prev.includes(newItemId) ? prev : [...prev, newItemId]);
    showAlert(`Đã thêm ${finalQty} sản phẩm vào giỏ hàng! ✨`, "success");
  };

  const openQuickView = (product: Product) => {
    setQuickViewProduct(product);
    setQuickViewOptions({});
    setQuickViewQuantity(product.minQuantity || 1);
    setSelectedQuickViewImage(product.image);
  };

  const handleAddToCartClick = (product: Product) => {
    if ((product.options && product.options.length > 0) || product.purchaseMode === 'combo') {
      openQuickView(product);
    } else {
      addToCart(product, undefined, product.minQuantity || 1);
    }
  };

  const handleBuyNowClick = (product: Product) => {
    if ((product.options && product.options.length > 0) || product.purchaseMode === 'combo') {
      openQuickView(product);
    } else {
      handleBuyNow(product, undefined, product.minQuantity || 1);
    }
  };

  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.account-menu-container')) {
        setShowAccountMenu(false);
      }
      // Close admin menus if clicking outside the relative containers
      if (!(event.target as Element).closest('.relative')) {
        setActiveAdminMenu(null);
        setActiveStatusMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [currentSlide, setCurrentSlide] = useState(0);
  const bannerSlides = categories.filter(c => c.id !== 'all');
  const safeCurrentSlide = bannerSlides.length > 0 ? currentSlide % bannerSlides.length : 0;

  useEffect(() => {
    if (selectedCategory === 'all' && bannerSlides.length > 0) {
      const timer = setInterval(() => {
        setCurrentSlide((prev) => (prev + 1) % bannerSlides.length);
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [selectedCategory, bannerSlides.length]);

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const itemsToCheckout = directBuyItem ? [directBuyItem] : cart.filter(item => selectedCartItems.includes(getCartItemId(item)));
  const cartTotal = itemsToCheckout.reduce((acc, item) => acc + item.product.price * item.quantity, 0);

  const getIcon = (iconName: string) => {
    const props = { className: "w-5 h-5" };
    switch (iconName) {
      case 'Sparkles': return <Sparkles {...props} />;
      case 'PenLine': return <PenLine {...props} />;
      case 'BookOpen': return <BookOpen {...props} />;
      case 'Palette': return <Palette {...props} />;
      case 'Scissors': return <Scissors {...props} />;
      default: return <Sparkles {...props} />;
    }
  };

  return (
    <div className={isAdminView ? "min-h-screen bg-gray-50 p-8 font-sans" : "min-h-screen flex flex-col font-sans bg-[#fffcfd] selection:bg-primary/30 selection:text-primary-dark relative overflow-x-hidden"}>
        <AnimatePresence>
          {(!isAuthReady || !isSettingsLoaded) && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center p-6"
          >
            <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-8 overflow-hidden border-4 border-primary-light shadow-2xl p-2 animate-pulse">
              <img src={cleanImageUrl(settings.mascotImage)} className="w-full h-full object-contain" onError={(e) => (e.target as HTMLImageElement).src = "https://picsum.photos/seed/pink-panther/400/400"} />
            </div>
            <div className="flex flex-col items-center gap-4">
              <div className="flex gap-2">
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-3 h-3 bg-primary-dark rounded-full" />
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-3 h-3 bg-primary-dark rounded-full" />
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-3 h-3 bg-primary-dark rounded-full" />
              </div>
              <p className="text-primary-dark font-black uppercase tracking-widest text-sm">
                {connectionError ? "Lỗi kết nối máy chủ!" : "Đang tải thế giới HanaChiBi..."}
              </p>
              {connectionError && (
                <div className="mt-4 p-4 bg-red-50 border-2 border-red-100 rounded-2xl text-center max-w-md">
                  <p className="text-red-500 text-xs font-bold mb-2">{connectionError}</p>
                  <p className="text-gray-500 text-[10px]">Vui lòng kiểm tra lại kết nối mạng hoặc máy chủ của bạn.</p>
                  <button 
                    onClick={() => window.location.reload()}
                    className="mt-4 px-6 py-2 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-full hover:bg-red-600 transition-all"
                  >
                    Thử lại ngay
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {isAdminView ? (
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
            <h2 className="text-4xl font-black text-gray-900">Quản trị HanaChiBi 🐾</h2>
            <div className="flex gap-4">
              <button 
                onClick={() => setAdminTab('orders')} 
                className={`px-8 py-3 rounded-2xl font-black transition-all ${adminTab === 'orders' ? 'bg-primary-dark text-white' : 'bg-white text-gray-400'}`}
              >
                Đơn hàng
              </button>
              <button 
                onClick={() => setAdminTab('stats')} 
                className={`px-8 py-3 rounded-2xl font-black transition-all ${adminTab === 'stats' ? 'bg-primary-dark text-white' : 'bg-white text-gray-400'}`}
              >
                Thống kê
              </button>
              <button 
                onClick={() => { setAdminTab('products'); }} 
                className={`px-8 py-3 rounded-2xl font-black transition-all ${adminTab === 'products' ? 'bg-primary-dark text-white' : 'bg-white text-gray-400'}`}
              >
                Sản phẩm
              </button>
              <button 
                onClick={() => setAdminTab('categories')} 
                className={`px-8 py-3 rounded-2xl font-black transition-all ${adminTab === 'categories' ? 'bg-primary-dark text-white' : 'bg-white text-gray-400'}`}
              >
                Danh mục
              </button>
              <button 
                onClick={() => setAdminTab('settings')} 
                className={`px-8 py-3 rounded-2xl font-black transition-all ${adminTab === 'settings' ? 'bg-primary-dark text-white' : 'bg-white text-gray-400'}`}
              >
                Cài đặt
              </button>
              <button onClick={() => { toggleAdminView(false); setOrderDetail(null); setShowCancelModal(null); }} className="btn-primary px-8">Quay lại Shop</button>
            </div>
          </div>
          
          {adminTab === 'orders' ? (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-grow relative">
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input 
                    type="text"
                    placeholder="Tìm kiếm theo mã đơn hàng hoặc tên khách hàng..."
                    value={adminOrderSearch}
                    onChange={e => setAdminOrderSearch(e.target.value)}
                    className="w-full pl-16 pr-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm transition-all"
                  />
                </div>
                <div className="flex flex-wrap gap-3 bg-white p-4 rounded-2xl shadow-sm">
                  {["Tất cả", "Chờ xác nhận", "Chờ lấy hàng", "Chờ giao hàng", "Đã giao", "Trả hàng", "Đã hủy"].map(status => (
                    <button 
                      key={status}
                      onClick={() => setSelectedOrderStatus(status)}
                      className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${selectedOrderStatus === status ? 'bg-primary-dark text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-6">
                {orders.filter(o => {
                  const matchesStatus = selectedOrderStatus === "Tất cả" || o.status === selectedOrderStatus;
                  const matchesSearch = o.id.toString().includes(adminOrderSearch) || o.customer.name.toLowerCase().includes(adminOrderSearch.toLowerCase());
                  return matchesStatus && matchesSearch;
                }).length === 0 ? (
                  <div className="bg-white p-20 rounded-[3rem] text-center shadow-sm">
                    <p className="text-gray-400 font-bold text-xl">Chưa có đơn hàng nào trong mục này...</p>
                  </div>
                ) : (
                  orders
                    .filter(o => {
                      const matchesStatus = selectedOrderStatus === "Tất cả" || o.status === selectedOrderStatus;
                      const matchesSearch = o.id.toString().includes(adminOrderSearch) || o.customer.name.toLowerCase().includes(adminOrderSearch.toLowerCase());
                      return matchesStatus && matchesSearch;
                    })
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map(order => (
                      <div key={order.id} className="bg-white p-8 rounded-[2.5rem] shadow-sm border-2 border-primary-light/20 group hover:border-primary-light transition-all">
                        <div className="flex flex-col md:flex-row justify-between gap-6">
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <span className="bg-primary-light text-primary-dark px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase">#{order.id}</span>
                              <span className="text-gray-400 text-xs font-bold">{new Date(order.createdAt).toLocaleString('vi-VN')}</span>
                              <div className="relative">
                                <button 
                                  onClick={() => setActiveStatusMenu(activeStatusMenu === order.id ? null : order.id)}
                                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                                    order.status === 'Đã giao' ? 'bg-green-100 text-green-600' :
                                    order.status === 'Đã hủy' ? 'bg-red-100 text-red-600' :
                                    order.status === 'Chờ xác nhận' ? 'bg-yellow-100 text-yellow-600' :
                                    'bg-blue-100 text-blue-600'
                                  }`}
                                >
                                  {order.status}
                                </button>
                                <AnimatePresence>
                                  {activeStatusMenu === order.id && (
                                    <motion.div 
                                      initial={{ opacity: 0, y: 10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 10 }}
                                      className="absolute top-full left-0 mt-2 bg-white shadow-2xl rounded-2xl p-2 z-50 border-2 border-gray-50 min-w-[180px] grid grid-cols-1 gap-1"
                                    >
                                      {["Chờ xác nhận", "Chờ lấy hàng", "Chờ giao hàng", "Đã giao", "Trả hàng", "Đã hủy"].map(s => (
                                        <button 
                                          key={s}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleUpdateOrderStatus(order.id, { status: s });
                                            setActiveStatusMenu(null);
                                          }}
                                          className="text-left px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-light/20 text-gray-500 hover:text-primary-dark transition-all"
                                        >
                                          Chuyển sang: {s}
                                        </button>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                            <h4 className="text-2xl font-black text-gray-900">{order.customer.name}</h4>
                            <div className="flex flex-col gap-1">
                              <p className="text-gray-500 font-bold flex items-center gap-2"><Phone className="w-4 h-4" /> {order.customer.phone}</p>
                              <p className="text-gray-500 font-medium flex items-center gap-2"><MapPin className="w-4 h-4" /> {order.customer.fullAddress || order.customer.address}</p>
                            </div>
                            
                            {/* Admin Order Item Summary */}
                            <div className="mt-4 pt-4 border-t border-gray-50 space-y-2">
                              {order.items.slice(0, 3).map((item: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-[10px] font-bold text-gray-400">
                                  <div className="w-6 h-6 rounded bg-gray-50 flex items-center justify-center shrink-0">
                                    <img src={cleanImageUrl(item.product?.image)} className="w-full h-full object-cover rounded" />
                                  </div>
                                  <span className="line-clamp-1">{item.product?.name}</span>
                                  {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                                    <span className="text-primary-dark italic">({Object.values(item.selectedOptions).join(', ')})</span>
                                  )}
                                  <span className="ml-auto text-gray-900">x{item.quantity}</span>
                                </div>
                              ))}
                              {order.items.length > 3 && (
                                <p className="text-[9px] font-bold text-primary-dark ml-8">...và {order.items.length - 3} sản phẩm khác</p>
                              )}
                            </div>

                            {order.customer.note && (
                              <div className="bg-primary-light/10 p-4 rounded-2xl border-l-4 border-primary-dark">
                                <p className="text-primary-dark font-bold italic text-sm">" {order.customer.note} "</p>
                              </div>
                            )}
                          </div>
                          <div className="text-right flex flex-col justify-between items-end">
                            <div className="space-y-1">
                              <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Tổng thanh toán:</p>
                              <p className="text-3xl font-black text-primary-dark">{order.total.toLocaleString('vi-VN')}đ</p>
                              {order.discount > 0 && <p className="text-xs font-bold text-green-500">Đã giảm: {order.discount.toLocaleString('vi-VN')}đ</p>}
                            </div>
                            <div className="flex gap-3 mt-6 relative">
                              {order.status === 'Chờ xác nhận' && (
                                <button 
                                  onClick={() => handleUpdateOrderStatus(order.id, { status: 'Chờ lấy hàng' })}
                                  className="px-6 py-3 rounded-xl bg-primary-dark text-white text-xs font-black uppercase tracking-widest hover:bg-primary-dark/90 transition-all shadow-lg shadow-primary-dark/20 flex items-center gap-2"
                                >
                                  <Check className="w-4 h-4" /> Xác nhận đơn
                                </button>
                              )}
                              <button 
                                onClick={() => setActiveAdminMenu(activeAdminMenu === order.id ? null : order.id)}
                                className={`p-3 rounded-xl transition-all ${activeAdminMenu === order.id ? 'bg-primary-light text-primary-dark' : 'bg-gray-50 text-gray-400 hover:bg-primary-light/20 hover:text-primary-dark'}`}
                              >
                                <MoreVertical className="w-5 h-5" />
                              </button>
                              <AnimatePresence>
                                {activeAdminMenu === order.id && (
                                  <motion.div 
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    className="absolute bottom-full right-0 mb-2 bg-white shadow-2xl rounded-2xl p-2 z-50 border-2 border-gray-50 min-w-[180px]"
                                  >
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOrderDetail(order);
                                        setActiveAdminMenu(null);
                                      }}
                                      className="w-full text-left px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary-light/20 text-gray-500 hover:text-primary-dark transition-all flex items-center gap-3"
                                    >
                                      <Eye className="w-4 h-4" /> Chi tiết
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        try { window.print(); } catch(err) { console.error(err); }
                                        setActiveAdminMenu(null);
                                      }}
                                      className="w-full text-left px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary-light/20 text-gray-500 hover:text-primary-dark transition-all flex items-center gap-3"
                                    >
                                      <Printer className="w-4 h-4" /> In hóa đơn
                                    </button>
                                    {order.status !== 'Đã hủy' && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCancellingOrder(order);
                                          setShowCancelModal({ orderId: order.id, type: 'admin' });
                                          setCancelStep('confirm');
                                          setActiveAdminMenu(null);
                                        }}
                                        className="w-full text-left px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-50 text-red-400 hover:text-red-600 transition-all flex items-center gap-3"
                                      >
                                        <Trash2 className="w-4 h-4" /> Hủy đơn
                                      </button>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>
                        <div className="mt-8 pt-8 border-t grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {(order.items || []).map((item: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-4 bg-gray-50 p-4 rounded-[1.5rem] border border-gray-100">
                              <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0">
                                <img src={item.product?.image || "https://picsum.photos/seed/placeholder/100/100"} className="w-full h-full object-cover" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-black text-gray-800 line-clamp-1">{item.product?.name || "Sản phẩm không xác định"}</p>
                                <p className="text-xs font-bold text-gray-400">Số lượng: {item.quantity} • {(item.product?.price || 0).toLocaleString('vi-VN')}đ</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          ) : adminTab === 'stats' ? (
            <div className="space-y-12">
              {/* Stats Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                {[
                  { 
                    label: "Doanh thu hôm nay", 
                    value: orders.filter(o => {
                      const orderDate = new Date(o.createdAt).toDateString();
                      const today = new Date().toDateString();
                      return orderDate === today && o.status !== "Đã hủy";
                    }).reduce((acc, o) => acc + o.total, 0).toLocaleString('vi-VN') + "đ",
                    icon: Zap,
                    color: "bg-orange-100 text-orange-600"
                  },
                  { 
                    label: "Đơn hàng mới", 
                    value: orders.filter(o => {
                      const orderDate = new Date(o.createdAt).toDateString();
                      const today = new Date().toDateString();
                      return orderDate === today && o.status !== "Đã hủy";
                    }).length.toLocaleString('vi-VN'),
                    icon: ShoppingBag,
                    color: "bg-blue-100 text-blue-600"
                  },
                  { 
                    label: "Sản phẩm đã bán", 
                    value: orders.filter(o => o.status !== "Đã hủy").reduce((acc, o) => acc + (o.items?.reduce((pacc: number, item: any) => pacc + item.quantity, 0) || 0), 0).toLocaleString('vi-VN'),
                    icon: Check,
                    color: "bg-green-100 text-green-600"
                  },
                  { 
                    label: "Tổng lợi nhuận", 
                    value: (orders.filter(o => o.status !== "Đã hủy").reduce((acc, o) => acc + o.total, 0) * 0.4).toLocaleString('vi-VN') + "đ", // Mẫu Giả định lãi 40%
                    icon: HeartIcon,
                    color: "bg-pink-100 text-pink-600"
                  }
                ].map((stat, i) => (
                  <div key={i} className="bg-white p-8 rounded-[2.5rem] shadow-sm border-2 border-primary-light/10 flex items-center gap-6">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${stat.color}`}>
                      <stat.icon className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
                      <h4 className="text-2xl font-black text-gray-900">{stat.value}</h4>
                    </div>
                  </div>
                ))}
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] shadow-sm border-2 border-primary-light/10">
                  <h4 className="text-xl font-black text-gray-900 mb-8">Doanh thu 7 ngày qua🐾</h4>
                  <div className="h-[400px]">
                    <CustomSimpleAreaChart data={[...Array(7)].map((_, i) => {
                      const date = new Date();
                      date.setDate(date.getDate() - (6 - i));
                      const dateStr = date.toDateString();
                      const revenue = orders
                        .filter(o => new Date(o.createdAt).toDateString() === dateStr && o.status !== "Đã hủy")
                        .reduce((acc, o) => acc + o.total, 0);
                      return { name: date.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric' }), value: revenue };
                    })} />
                  </div>
                </div>

                <div className="bg-white p-10 rounded-[3rem] shadow-sm border-2 border-primary-light/10">
                  <h4 className="text-xl font-black text-gray-900 mb-8">Top 5 Bán Chạy 🎀</h4>
                  <div className="space-y-6">
                    {Array.from(
                      orders.filter(o => o.status !== "Đã hủy").reduce((acc, o) => {
                        (o.items || []).forEach((item: any) => {
                          const id = item.product.id;
                          if (!acc.has(id)) acc.set(id, { name: item.product.name, qty: 0, revenue: 0, image: item.product.image });
                          const entry = acc.get(id);
                          entry.qty += item.quantity;
                          entry.revenue += item.quantity * item.product.price;
                        });
                        return acc;
                      }, new Map()).values()
                    )
                    .sort((a, b) => b.qty - a.qty)
                    .slice(0, 5)
                    .map((p: any, i) => (
                      <div key={i} className="flex items-center gap-4 group">
                        <div className="w-16 h-16 rounded-2xl bg-gray-50 overflow-hidden border-2 border-gray-50 shadow-sm relative shrink-0">
                          <img src={cleanImageUrl(p.image)} className="w-full h-full object-cover" />
                          <div className="absolute top-0 left-0 bg-primary-dark text-white text-[10px] font-black w-6 h-6 flex items-center justify-center rounded-br-xl">
                            {i + 1}
                          </div>
                        </div>
                        <div className="min-w-0 flex-grow">
                          <p className="font-black text-gray-900 text-sm line-clamp-1 group-hover:text-primary-dark transition-colors">{p.name}</p>
                          <p className="text-xs font-bold text-gray-400 mt-0.5">{p.qty} sản phẩm • <span className="text-primary-dark font-black">{p.revenue.toLocaleString('vi-VN')}đ</span></p>
                        </div>
                      </div>
                    ))}
                    {orders.length === 0 && <p className="text-gray-400 font-bold text-center py-20 italic">Chưa có dữ liệu giao dịch...</p>}
                  </div>
                </div>
              </div>

              {/* Recent Orders Table */}
              <div className="bg-white p-10 rounded-[3rem] shadow-sm border-2 border-primary-light/10 overflow-hidden">
                <div className="flex justify-between items-center mb-8">
                  <h4 className="text-xl font-black text-gray-900">Đơn hàng mới gần đây 🐾</h4>
                  <button onClick={() => setAdminTab('orders')} className="text-sm font-black text-primary-dark hover:underline">Xem tất cả</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b-2 border-gray-50">
                        <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Thời gian</th>
                        <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Sản phẩm</th>
                        <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Số lượng</th>
                        <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Tổng tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 font-bold">
                      {orders.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5).map(o => (
                        <tr key={o.id} className="group hover:bg-gray-50/50 transition-colors">
                          <td className="py-6 pr-6">
                            <p className="text-gray-900 text-sm">{new Date(o.createdAt).toLocaleDateString('vi-VN')}</p>
                            <p className="text-[10px] text-gray-400 italic">{new Date(o.createdAt).toLocaleTimeString('vi-VN')}</p>
                          </td>
                          <td className="py-6 pr-6">
                            <div className="space-y-1">
                              {o.items.map((item: any, idx: number) => (
                                <p key={idx} className="text-xs text-gray-700 line-clamp-1 truncate max-w-[200px]">• {item.product.name}</p>
                              ))}
                            </div>
                          </td>
                          <td className="py-6 text-center font-black text-gray-900">
                            {o.items.reduce((acc: number, item: any) => acc + item.quantity, 0)}
                          </td>
                          <td className="py-6 text-right">
                            <p className="text-primary-dark font-black">{o.total.toLocaleString('vi-VN')}đ</p>
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                              o.status === 'Đã giao' ? 'bg-green-100 text-green-600' :
                              o.status === 'Đã hủy' ? 'bg-red-100 text-red-600' :
                              'bg-primary-light/20 text-primary-dark'
                            }`}>{o.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : adminTab === 'products' ? (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                  <h3 className="text-2xl font-black text-gray-800">Danh sách sản phẩm ({liveProducts.length})</h3>
                  <div className="mt-4 relative w-full md:w-96">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input 
                      type="text"
                      placeholder="Tìm kiếm sản phẩm trong kho..."
                      value={adminProductSearch}
                      onChange={e => setAdminProductSearch(e.target.value)}
                      className="w-full pl-16 pr-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm transition-all text-sm"
                    />
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const firstCat = categories.find(c => c.id !== 'all');
                    setEditingProduct({ 
                      name: "", 
                      price: 0, 
                      category: firstCat?.id || "other", 
                      image: "https://picsum.photos/seed/new/600/600", 
                      images: [],
                      description: "", 
                      details: "",
                      totalStock: 100,
                      rating: 5, 
                      reviews: 0 
                    });
                    setRawProductOptions([]);
                    setComboInput("");
                  }}
                  className="btn-primary px-8"
                >
                  Thêm sản phẩm mới 🐾
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {liveProducts.filter(p => p.name.toLowerCase().includes(adminProductSearch.toLowerCase())).map(product => (
                  <div key={product.id} className="bg-white p-6 rounded-[2.5rem] shadow-sm flex gap-4 items-center border-2 border-transparent hover:border-primary-light transition-all">
                    <img src={product.image} className="w-24 h-24 rounded-2xl object-cover" referrerPolicy="no-referrer" />
                    <div className="flex-grow">
                      <h4 className="font-bold text-gray-800 line-clamp-1">{product.name}</h4>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full uppercase tracking-widest">
                          {categories.find(c => c.id === product.category)?.name || "Chưa phân loại"}
                        </span>
                        {product.subCategory && (
                          <span className="text-[10px] font-black px-2 py-0.5 bg-primary-light/20 text-primary-dark rounded-full uppercase tracking-widest">
                            {product.subCategory}
                          </span>
                        )}
                      </div>
                      <p className="text-primary-dark font-black">{product.price.toLocaleString('vi-VN')}đ</p>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => {
                          setEditingProduct(product);
                          setRawProductOptions(product.options?.map(o => o.values.join(", ")) || []);
                          setComboInput(product.combos?.join(", ") || "");
                        }} className="text-xs font-black text-blue-500 hover:underline">Sửa</button>
                        <button onClick={() => handleDeleteProduct(product.id)} className="text-xs font-black text-red-500 hover:underline">Xóa</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : adminTab === 'settings' ? (
            <div className="max-w-4xl mx-auto space-y-12">
              {!isSettingsLoaded ? (
                <div className="bg-white p-20 rounded-[3rem] shadow-sm border-2 border-primary-light/20 flex flex-col items-center justify-center gap-6">
                  <div className="w-16 h-16 border-4 border-primary-light border-t-primary rounded-full animate-spin"></div>
                  <p className="text-gray-500 font-black animate-pulse">Đang tải cài đặt hệ thống... 🐾</p>
                </div>
              ) : (
                <div className="bg-white p-10 rounded-[3rem] shadow-sm border-2 border-primary-light/20">
                  <h3 className="text-2xl font-black text-gray-900 mb-8 flex items-center gap-3">
                    <Sparkles className="w-6 h-6 text-primary-dark" /> Cài đặt giao diện 🐾
                  </h3>
                  
                  <div className="space-y-10">
                    {/* Debug Info for Admin */}
                    <div className="bg-blue-50 p-4 rounded-2xl text-[10px] font-mono text-blue-600 flex justify-between items-center">
                      <span>ADMIN DEBUG: {user?.email} | Role: {user?.role}</span>
                      <span className="bg-blue-200 px-2 py-0.5 rounded-full">Verified: {user?.emailVerified ? 'YES' : 'NO'}</span>
                    </div>

                    {/* Logo Upload */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Logo cửa hàng</label>
                      <p className="text-sm text-gray-500 font-medium">Logo hiển thị trên thanh điều hướng và các trang chính.</p>
                      <div className="mt-4 flex items-center gap-6">
                        <div className="w-24 h-24 bg-white rounded-3xl border-2 border-primary-light shadow-sm flex items-center justify-center overflow-hidden relative group transition-all hover:shadow-md">
                          {isUploading ? (
                            <div className="w-full h-full flex items-center justify-center bg-gray-50">
                              <Sparkles className="w-6 h-6 text-primary-dark animate-spin" />
                            </div>
                          ) : (
                            <>
                              <img src={cleanImageUrl(settings.logo)} className="w-full h-full object-contain p-3" referrerPolicy="no-referrer" onError={(e) => (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/hanachibi/200/200'} />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Upload className="w-6 h-6 text-white" />
                              </div>
                            </>
                          )}
                            <input 
                              type="file" 
                              accept="image/*"
                              disabled={isUploading}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setIsUploading(true);
                                  try {
                                    const imageUrl = await uploadImage(file, "settings");
                                    await updateSettings({ logo: imageUrl });
                                    showAlert("Tải logo thành công! ✨", "success");
                                  } catch (error) {
                                    handleFirestoreError(error, OperationType.WRITE, "settings");
                                  } finally {
                                    setIsUploading(false);
                                  }
                                }
                              }}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                        </div>
                        <input 
                          value={settings.logo}
                          onChange={e => setSettings(prev => ({...prev, logo: e.target.value}))}
                          className="flex-grow px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                          placeholder="Link logo..."
                        />
                      </div>
                    </div>
                  </div>

                  <hr className="border-gray-50" />

                  {/* Login Banner */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Banner trang đăng nhập</label>
                      <p className="text-sm text-gray-500 font-medium">Hình ảnh và nội dung hiển thị khi khách hàng chưa đăng nhập.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Banner đăng nhập</label>
                        <div className="flex gap-4">
                          <input 
                            value={settings.loginBanner}
                            onChange={e => setSettings(prev => ({...prev, loginBanner: e.target.value}))}
                            className="flex-1 px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                            placeholder="Link banner đăng nhập..."
                          />
                          <div className="relative">
                            <button type="button" disabled={isUploading} className="h-full px-6 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all flex items-center gap-2">
                              {isUploading ? <Sparkles className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />} Tải lên
                            </button>
                            <input 
                              type="file" 
                              accept="image/*"
                              disabled={isUploading}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setIsUploading(true);
                                  try {
                                    const imageUrl = await uploadImage(file, "settings");
                                    await updateSettings({ loginBanner: imageUrl });
                                    showAlert("Tải banner thành công! ✨", "success");
                                  } catch (error: any) {
                                    handleFirestoreError(error, OperationType.WRITE, "settings");
                                  } finally {
                                    setIsUploading(false);
                                  }
                                }
                              }}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                          </div>
                        </div>
                        {settings.loginBanner && (
                          <div className="relative aspect-video rounded-3xl overflow-hidden border-2 border-primary-light">
                            <img 
                              src={cleanImageUrl(settings.loginBanner)} 
                              className="w-full h-full object-cover" 
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi-main/1000/800";
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Câu khẩu hiệu (Slogan)</label>
                        <textarea 
                          value={settings.loginBannerText}
                          onChange={e => setSettings(prev => ({...prev, loginBannerText: e.target.value}))}
                          className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold h-32 resize-none"
                          placeholder="Chào bạn! Pink Panther đang đợi bạn đây nhé..."
                        />
                      </div>
                    </div>
                  </div>

                  <hr className="border-gray-50" />

                  {/* Mascot Settings */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Linh vật (Mascot)</label>
                      <p className="text-sm text-gray-500 font-medium">Hình ảnh linh vật và lời chào hiển thị trong form đăng nhập.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                         <div className="relative w-40 h-40 rounded-full bg-white border-4 border-primary-light shadow-xl flex items-center justify-center overflow-hidden group mx-auto md:mx-0">
                          <div className="w-full h-full rounded-full overflow-hidden bg-white border-2 border-primary-light/20">
                            {isUploading ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Sparkles className="w-8 h-8 text-primary-dark animate-spin" />
                              </div>
                            ) : (
                              <img 
                                key={settings.mascotImage} 
                                src={cleanImageUrl(settings.mascotImage)} 
                                className="w-full h-full object-contain p-2" 
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "https://picsum.photos/seed/pink-panther/400/400";
                                }}
                              />
                            )}
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Upload className="w-8 h-8 text-white" />
                          </div>
                            <input 
                              type="file" 
                              accept="image/*"
                              disabled={isUploading}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setIsUploading(true);
                                  try {
                                    const imageUrl = await uploadImage(file, "settings");
                                    await updateSettings({ mascotImage: imageUrl });
                                    showAlert("Tải linh vật thành công! ✨", "success");
                                  } catch (error: any) {
                                    handleFirestoreError(error, OperationType.WRITE, "settings");
                                  } finally {
                                    setIsUploading(false);
                                  }
                                }
                              }}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                        </div>
                        <input 
                          value={settings.mascotImage}
                          onChange={e => setSettings(prev => ({ ...prev, mascotImage: e.target.value }))}
                          className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                          placeholder="Link ảnh linh vật..."
                        />
                      </div>
                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lời chào linh vật</label>
                        <textarea 
                          value={settings.mascotText}
                          onChange={e => setSettings(prev => ({ ...prev, mascotText: e.target.value }))}
                          className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold h-32 resize-none"
                          placeholder="Chào bạn! Pink Panther đang đợi bạn đây nhé~ 🐾"
                        />
                      </div>
                    </div>
                  </div>

                  <hr className="border-gray-50" />

                  {/* QR Code Settings */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Mã QR Thanh toán</label>
                      <p className="text-sm text-gray-500 font-medium">Tải lên mã QR ngân hàng của bạn để khách hàng quét khi thanh toán.</p>
                    </div>
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                      <div className="relative w-48 aspect-square rounded-3xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden group">
                        {settings.qrCode ? (
                          <img src={cleanImageUrl(settings.qrCode)} className="w-full h-full object-contain p-2" />
                        ) : (
                          <div className="text-center p-4">
                            <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-[10px] font-bold text-gray-400">Tải mã QR</p>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Upload className="w-8 h-8 text-white" />
                        </div>
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const imageUrl = await uploadImage(file, "settings");
                                await updateSettings({ qrCode: imageUrl });
                              } catch (error) {
                                console.error("Lỗi tải mã QR:", error);
                                showAlert("Lỗi tải mã QR. Vui lòng thử lại.", "error");
                              }
                            }
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </div>
                      <div className="flex-grow space-y-4 w-full">
                        <input 
                          value={settings.qrCode}
                          onChange={e => setSettings(prev => ({...prev, qrCode: e.target.value}))}
                          className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                          placeholder="Hoặc dán link mã QR..."
                        />
                        <p className="text-xs text-gray-400 italic font-medium">* Nếu để trống, hệ thống sẽ tự động tạo mã QR mặc định của shop.</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-10">
                    <button 
                      onClick={() => handleSaveSettings(settings)}
                      className="w-full btn-primary py-5 text-lg shadow-2xl shadow-primary/30"
                    >
                      Lưu tất cả thay đổi ✨
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-black text-gray-800">Quản lý danh mục ({categories.length})</h3>
                <button 
                  onClick={() => {
                    setEditingCategory({ id: `cat-${Date.now()}`, name: "", icon: "Sparkles", image: "", banner: "", subCategories: [] });
                    setSubCategoriesInput("");
                  }}
                  className="btn-primary px-8 py-4 flex items-center gap-3 shadow-xl"
                >
                  <Sparkles className="w-5 h-5" /> Thêm danh mục mới
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map(cat => (
                  <div key={cat.id} className="bg-white p-8 rounded-[2.5rem] shadow-sm border-2 border-primary-light/20 group hover:border-primary-light transition-all">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-16 h-16 bg-primary-light/20 rounded-2xl flex items-center justify-center text-primary-dark overflow-hidden border-2 border-gray-50">
                        {cat.image ? (
                          <img src={cleanImageUrl(cat.image)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          getIcon(cat.icon)
                        )}
                      </div>
                      <h4 className="text-xl font-black text-gray-900">{cat.name}</h4>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Danh mục con:</p>
                        {cat.priority !== undefined && (
                          <span className="text-[10px] font-black text-primary-dark bg-primary-light/30 px-2 py-0.5 rounded-full">Thứ tự: {cat.priority}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(cat.subCategories || []).map(sub => (
                          <span key={sub} className="px-3 py-1 bg-gray-50 rounded-lg text-[10px] font-bold text-gray-500">{sub}</span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-8 flex gap-4">
                      <button 
                        onClick={() => {
                          setEditingCategory(cat);
                          setSubCategoriesInput(cat.subCategories?.join(", ") || "");
                        }}
                        className="text-xs font-black text-blue-500 hover:underline uppercase tracking-widest"
                      >
                        Sửa
                      </button>
                      <button 
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="text-xs font-black text-red-400 hover:text-red-600 transition-colors uppercase tracking-widest"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Category Edit Modal */}
              <AnimatePresence>
                {editingCategory && (
                  <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingCategory(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }} 
                      animate={{ scale: 1, opacity: 1 }} 
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="relative bg-white w-full max-w-lg rounded-[3rem] shadow-2xl p-10"
                    >
                      <h3 className="text-2xl font-black text-gray-900 mb-8">Danh mục 🐾</h3>
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        handleSaveCategory({
                          ...editingCategory,
                          subCategories: subCategoriesInput.split(",").map(s => s.trim()).filter(s => s !== "")
                        });
                      }} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Tên danh mục</label>
                            <input 
                              required
                              value={editingCategory.name}
                              onChange={e => setEditingCategory({...editingCategory, name: e.target.value})}
                              className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Thứ tự hiển thị (Priority)</label>
                            <input 
                              type="number"
                              value={editingCategory.priority || 0}
                              onChange={e => setEditingCategory({...editingCategory, priority: parseInt(e.target.value) || 0})}
                              className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Danh mục con (cách nhau bằng dấu phẩy)</label>
                          <input 
                            value={subCategoriesInput}
                            onChange={e => setSubCategoriesInput(e.target.value)}
                            className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                            placeholder="Bút bi, Bút chì..."
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {/* Item 1: Thumbnail/Icon */}
                          <div className="space-y-4">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Ảnh đại diện (Icon)</label>
                            <div className="flex gap-2">
                              <input 
                                placeholder="Link ảnh..."
                                value={editingCategory.image || ""}
                                onChange={e => setEditingCategory({...editingCategory, image: cleanImageUrl(e.target.value)})}
                                className="flex-1 px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                              />
                              <div className="relative">
                                <button 
                                  type="button" 
                                  disabled={isUploading}
                                  className="h-full px-4 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all disabled:opacity-50"
                                >
                                  {isUploading ? <Sparkles className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                                </button>
                                <input 
                                  type="file" 
                                  accept="image/*"
                                  disabled={isUploading}
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setIsUploading(true);
                                      try {
                                        const url = await uploadImage(file, 'categories');
                                        setEditingCategory(prev => prev ? {...prev, image: url} : null);
                                      } finally {
                                        setIsUploading(false);
                                      }
                                    }
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                              </div>
                            </div>
                            {editingCategory.image && (
                              <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-primary-light/20 bg-gray-50">
                                <img src={cleanImageUrl(editingCategory.image)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                            )}
                          </div>

                          {/* Item 2: Banner */}
                          <div className="space-y-4">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Banner danh mục</label>
                            <div className="flex gap-2">
                              <input 
                                placeholder="Link banner..."
                                value={editingCategory.banner || ""}
                                onChange={e => setEditingCategory({...editingCategory, banner: cleanImageUrl(e.target.value)})}
                                className="flex-1 px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold"
                              />
                              <div className="relative">
                                <button 
                                  type="button" 
                                  disabled={isUploading}
                                  className="h-full px-4 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all disabled:opacity-50"
                                >
                                  {isUploading ? <Sparkles className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                                </button>
                                <input 
                                  type="file" 
                                  accept="image/*"
                                  disabled={isUploading}
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setIsUploading(true);
                                      try {
                                        const url = await uploadImage(file, 'categories');
                                        setEditingCategory(prev => prev ? {...prev, banner: url} : null);
                                      } finally {
                                        setIsUploading(false);
                                      }
                                    }
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                              </div>
                            </div>
                            {editingCategory.banner && (
                              <div className="w-full h-24 rounded-2xl overflow-hidden border-2 border-primary-light/20 bg-gray-50">
                                <img src={cleanImageUrl(editingCategory.banner)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-4 pt-4">
                          <button type="button" onClick={() => setEditingCategory(null)} className="flex-1 p-4 rounded-2xl bg-gray-100 text-gray-500 font-bold">Hủy</button>
                          <button type="submit" className="flex-1 btn-primary">Lưu lại</button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Product Edit Modal */}
          <AnimatePresence>
            {editingProduct && (
              <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingProduct(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }} 
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="relative bg-white w-full max-w-5xl rounded-[3rem] shadow-2xl p-8 md:p-12 max-h-[95vh] overflow-y-auto"
                >
                  <h3 className="text-3xl font-black text-gray-900 mb-10">{editingProduct.id ? "Sửa sản phẩm" : "Thêm sản phẩm"} 🐾</h3>
                  <form onSubmit={handleSaveProduct} className="space-y-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                      <div className="lg:col-span-7 space-y-8">
                        <div className="space-y-6">
                          <h4 className="text-sm font-black text-primary-dark uppercase tracking-widest flex items-center gap-2">
                             <Info className="w-4 h-4" /> Thông tin sản phẩm
                           </h4>
                          <div className="space-y-6 bg-gray-50/50 p-6 rounded-[2.5rem] border border-gray-100">
                             <div className="space-y-2">
                               <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Tên sản phẩm</label>
                               <input 
                                 required
                                 value={editingProduct.name}
                                 onChange={e => setEditingProduct({...editingProduct, name: e.target.value})}
                                 className="w-full px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm"
                               />
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Danh mục</label>
                                 <select 
                                   value={editingProduct.category}
                                   onChange={e => setEditingProduct({...editingProduct, category: e.target.value, subCategory: ""})}
                                   className="w-full px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm appearance-none"
                                 >
                                   {categories.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                 </select>
                               </div>
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Dòng sản phẩm</label>
                                 <select 
                                   value={editingProduct.subCategory || ""}
                                   onChange={e => setEditingProduct({...editingProduct, subCategory: e.target.value})}
                                   className="w-full px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm appearance-none"
                                 >
                                   <option value="">-- Chọn dòng --</option>
                                   {categories.find(c => c.id === editingProduct.category)?.subCategories?.map(sub => (
                                     <option key={sub} value={sub}>{sub}</option>
                                   ))}
                                 </select>
                               </div>
                             </div>
                             
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-100 pt-6">
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Thương hiệu</label>
                                 <select 
                                   value={editingProduct.brand || ""}
                                   onChange={e => setEditingProduct({...editingProduct, brand: e.target.value})}
                                   className="w-full px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm appearance-none"
                                 >
                                   <option value="">Chưa có thương hiệu</option>
                                   {["Thiên Long", "Flexoffice", "Điểm 10", "Colokit", "HanaChiBi"].map(brand => (
                                     <option key={brand} value={brand}>{brand}</option>
                                   ))}
                                 </select>
                               </div>
                               <div className="space-y-2">
                                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Chế độ mua hàng</label>
                                  <div className="flex bg-white p-1 rounded-2xl border border-gray-100 shadow-sm h-full">
                                    <button 
                                      type="button"
                                      onClick={() => setEditingProduct({...editingProduct, purchaseMode: 'quantity'})}
                                      className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${(!editingProduct.purchaseMode || editingProduct.purchaseMode === 'quantity') ? 'bg-primary-dark text-white shadow-lg' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                      Số lượng
                                    </button>
                                    <button 
                                      type="button"
                                      onClick={() => setEditingProduct({...editingProduct, purchaseMode: 'combo'})}
                                      className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${editingProduct.purchaseMode === 'combo' ? 'bg-primary-dark text-white shadow-lg' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                      Combo
                                    </button>
                                  </div>
                               </div>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-gray-100 pt-6">
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Giá bán (đ)</label>
                                 <input 
                                   required
                                   type="number"
                                   value={editingProduct.price}
                                   onChange={e => setEditingProduct({...editingProduct, price: parseInt(e.target.value)})}
                                   className="w-full px-6 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm"
                                 />
                               </div>
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Giá niêm yết</label>
                                 <input 
                                   type="number"
                                   value={editingProduct.originalPrice || ""}
                                   onChange={e => setEditingProduct({...editingProduct, originalPrice: e.target.value ? parseInt(e.target.value) : undefined})}
                                   className="w-full px-6 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm"
                                 />
                               </div>
                               <div className="space-y-2">
                                 <div 
                                   className="flex items-center gap-3 px-4 py-4 bg-primary-light/10 rounded-2xl border-2 border-transparent hover:border-primary-light transition-all cursor-pointer shadow-sm group h-full"
                                   onClick={() => {
                                     const el = document.getElementById('isFlashSale-modal') as HTMLInputElement;
                                     if (el) el.click();
                                   }}
                                 >
                                   <input 
                                     type="checkbox"
                                     id="isFlashSale-modal"
                                     checked={editingProduct.isFlashSale || false}
                                     onClick={(e) => e.stopPropagation()}
                                     onChange={e => {
                                       const checked = e.target.checked;
                                       const currentPrice = editingProduct.price || 0;
                                       const currentOriginal = editingProduct.originalPrice || 0;
                                       
                                       if (checked) {
                                         const newOriginal = currentOriginal > currentPrice ? currentOriginal : currentPrice;
                                         const newPrice = currentOriginal > currentPrice ? currentPrice : Math.round((currentPrice * 0.8) / 1000) * 1000;
                                         setEditingProduct({
                                           ...editingProduct,
                                           isFlashSale: true,
                                           originalPrice: newOriginal,
                                           price: newPrice
                                         });
                                       } else {
                                         setEditingProduct({
                                           ...editingProduct,
                                           isFlashSale: false,
                                           price: currentOriginal > 0 ? currentOriginal : currentPrice,
                                           originalPrice: undefined
                                         });
                                       }
                                     }}
                                     className="w-5 h-5 rounded-lg accent-primary-dark cursor-pointer"
                                   />
                                   <label htmlFor="isFlashSale-modal" className="font-black text-primary-dark cursor-pointer text-[9px] uppercase tracking-widest">Sale ⚡</label>
                                 </div>
                               </div>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-100 pt-6">
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">
                                   {editingProduct.purchaseMode === 'combo' ? 'Trong combo có' : 'Tối thiểu'}
                                 </label>
                                 <input 
                                   type="text"
                                   value={editingProduct.purchaseMode === 'combo' ? (comboInput !== "" ? comboInput : (editingProduct.combos?.join(", ") || "")) : (editingProduct.minQuantity || 1)}
                                   onChange={e => {
                                     if (editingProduct.purchaseMode === 'combo') {
                                       setComboInput(e.target.value);
                                       const combos = e.target.value.split(",").map(v => parseInt(v.trim())).filter(v => !isNaN(v));
                                       setEditingProduct({...editingProduct, combos});
                                     } else {
                                       setEditingProduct({...editingProduct, minQuantity: parseInt(e.target.value) || 1});
                                     }
                                   }}
                                   className="w-full px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm"
                                 />
                               </div>
                               <div className="space-y-2">
                                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Tồn kho</label>
                                 <input 
                                   type="number"
                                   value={editingProduct.totalStock || 0}
                                   onChange={e => setEditingProduct({...editingProduct, totalStock: parseInt(e.target.value) || 0})}
                                   className="w-full px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm"
                                 />
                               </div>
                             </div>
                          </div>
                        </div>

                        <div className="space-y-6">
                           <h4 className="flex items-center gap-3 text-sm font-black text-primary-dark uppercase tracking-widest px-4 border-l-4 border-primary-dark">
                             <PenLine className="w-4 h-4" /> Nội dung sản phẩm
                           </h4>
                           <div className="space-y-6">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Mô tả ngắn</label>
                              <textarea 
                                required
                                value={editingProduct.description}
                                onChange={e => setEditingProduct({...editingProduct, description: e.target.value})}
                                className="w-full px-8 py-4 rounded-3xl bg-gray-50/50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold h-32 shadow-sm resize-none"
                                placeholder="..."
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Thông số chi tiết</label>
                              <textarea 
                                value={editingProduct.details || ""}
                                onChange={e => setEditingProduct({...editingProduct, details: e.target.value})}
                                className="w-full px-8 py-4 rounded-3xl bg-gray-50/50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold h-56 shadow-sm resize-none"
                                placeholder="..."
                              />
                            </div>
                           </div>
                        </div>
                      </div>

                      {/* Right Side Column: Pricing & Images */}
                      <div className="lg:col-span-5 space-y-10">
                        <div className="space-y-6">
                           <h4 className="flex items-center gap-3 text-sm font-black text-primary-dark uppercase tracking-widest px-4 border-l-4 border-primary-dark">
                             <Upload className="w-4 h-4" /> Hình ảnh sản phẩm
                           </h4>
                           <div className="bg-gray-50/50 p-8 rounded-[2.5rem] border border-gray-100 space-y-8">
                             <div className="flex gap-4">
                                <input 
                                  placeholder="Dán link ảnh..."
                                  className="flex-1 px-8 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-primary-light outline-none font-bold shadow-sm"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const target = e.target as HTMLInputElement;
                                      if (target.value) {
                                        const url = cleanImageUrl(target.value);
                                        const currentImages = editingProduct.images || [];
                                        setEditingProduct({
                                          ...editingProduct,
                                          image: editingProduct.image || url,
                                          images: [...currentImages, url]
                                        });
                                        target.value = "";
                                      }
                                    }
                                  }}
                                />
                                <div className="relative">
                                  <button 
                                    type="button" 
                                    disabled={isUploading}
                                    className="h-full px-8 rounded-2xl bg-primary-dark text-white font-black hover:bg-black transition-all flex items-center gap-2 shadow-xl shadow-primary-dark/20 disabled:opacity-50"
                                  >
                                    {isUploading ? <Sparkles className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                                  </button>
                                  {!isUploading && (
                                    <input 
                                      type="file" 
                                      accept="image/*"
                                      onChange={handleProductImageUpload}
                                      className="absolute inset-0 opacity-0 cursor-pointer"
                                    />
                                  )}
                                </div>
                             </div>
                          
                          <div className="grid grid-cols-2 gap-6 mt-6">
                            {(editingProduct.images || []).map((img, idx) => (
                              <div key={idx} className="relative aspect-square rounded-[2rem] overflow-hidden border-4 border-white shadow-xl group hover:scale-[1.05] transition-all">
                                <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <button 
                                  type="button"
                                  onClick={() => {
                                    const newImgs = (editingProduct.images || []).filter((_, i) => i !== idx);
                                    setEditingProduct({
                                      ...editingProduct,
                                      images: newImgs,
                                      image: editingProduct.image === img ? (newImgs[0] || "") : editingProduct.image
                                    });
                                  }}
                                  className="absolute top-4 right-4 w-12 h-12 bg-red-500 text-white rounded-3xl flex items-center justify-center shadow-2xl z-10 transition-transform active:scale-90 hover:scale-110"
                                >
                                  <X className="w-7 h-7 stroke-[4]" />
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingProduct({ ...editingProduct, image: img })}
                                  className={`absolute bottom-4 left-4 right-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all z-10 ${editingProduct.image === img ? 'bg-primary-dark text-white shadow-lg' : 'bg-white/90 text-gray-600 opacity-0 group-hover:opacity-100'}`}
                                >
                                  {editingProduct.image === img ? "✨ Ảnh bìa" : "Làm ảnh bìa"}
                                </button>
                              </div>
                            ))}
                            {!(editingProduct.images || []).length && editingProduct.image && (
                               <div className="relative aspect-square rounded-3xl overflow-hidden border-2 border-primary-light group">
                                 <img src={editingProduct.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                 <div className="absolute top-2 right-2 p-1.5 bg-primary-dark text-white rounded-xl text-[8px] font-black uppercase px-3">Thumbnail</div>
                               </div>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 ml-4 italic leading-relaxed">* Dàn đều ảnh sản phẩm. Nhấn X để xóa, "Làm ảnh bìa" để chọn ảnh hiển thị chính nhé bạn! ~ 🌸</p>
                        </div>
                      </div>
                    </div>
                  </div>

                    <div className="space-y-4">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Phân loại (Màu sắc, Kích thước...)</label>
                      <div className="space-y-4 bg-gray-50 p-6 rounded-3xl border-2 border-gray-100">
                        {(editingProduct.options || []).map((opt, idx) => (
                          <div key={idx} className="bg-white p-6 rounded-[2rem] border-2 border-gray-100 space-y-6">
                            <div className="flex flex-col md:flex-row gap-6">
                              <div className="flex-grow space-y-4">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-black text-gray-400 uppercase ml-2">Tên (Ví dụ: Màu sắc)</label>
                                  <input 
                                    value={opt.name}
                                    onChange={e => {
                                      const newOpts = [...(editingProduct.options || [])];
                                      newOpts[idx] = { ...newOpts[idx], name: e.target.value };
                                      setEditingProduct({...editingProduct, options: newOpts});
                                    }}
                                    placeholder="Màu sắc"
                                    className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold text-sm transition-all"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-black text-gray-400 uppercase ml-2">Giá trị (Cách nhau bằng dấu phẩy)</label>
                                  <input 
                                    value={rawProductOptions[idx] !== undefined ? rawProductOptions[idx] : opt.values.join(", ")}
                                    onChange={e => {
                                      const newRaw = [...rawProductOptions];
                                      newRaw[idx] = e.target.value;
                                      setRawProductOptions(newRaw);
                                      
                                      const newOpts = [...(editingProduct.options || [])];
                                      newOpts[idx] = { ...newOpts[idx], values: e.target.value.split(",").map(v => v.trim()).filter(v => v !== "") };
                                      setEditingProduct({...editingProduct, options: newOpts});
                                    }}
                                    placeholder="Hồng, Xanh, Vàng"
                                    className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold text-sm transition-all"
                                  />
                                </div>
                              </div>
                              <button 
                                type="button"
                                onClick={() => {
                                  const newOpts = (editingProduct.options || []).filter((_, i) => i !== idx);
                                  setEditingProduct({...editingProduct, options: newOpts});
                                  setRawProductOptions(rawProductOptions.filter((_, i) => i !== idx));
                                }}
                                className="p-4 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all self-start"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>

                            {/* Option value images */}
                            {opt.values.length > 0 && (
                              <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase ml-4 block italic underline decoration-primary-light">Tải lên ảnh cho từng giá trị (Nếu cần đồng bộ ảnh khi khách chọn)</label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                  {opt.values.map(val => (
                                    <div key={val} className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 relative group">
                                      <p className="text-[10px] font-black text-gray-600 truncate pr-6">{val}</p>
                                      <div className="aspect-square bg-white rounded-xl overflow-hidden relative flex items-center justify-center border-2 border-dashed border-gray-200 group-hover:border-primary-light transition-all">
                                        {opt.images?.[val] ? (
                                          <img src={cleanImageUrl(opt.images[val])} className="w-full h-full object-cover" />
                                        ) : (
                                          <Upload className="w-5 h-5 text-gray-300" />
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4">
                                          <input 
                                            type="text" 
                                            placeholder="Dán link ảnh vào đây ✨"
                                            className="w-full px-4 py-2 rounded-lg bg-white text-[10px] font-bold outline-none text-gray-800"
                                            onBlur={(e) => {
                                              if (e.target.value) {
                                                const url = cleanImageUrl(e.target.value);
                                                const newOpts = [...(editingProduct.options || [])];
                                                const images = { ...(newOpts[idx].images || {}) };
                                                images[val] = url;
                                                newOpts[idx] = { ...newOpts[idx], images };
                                                setEditingProduct({...editingProduct, options: newOpts});
                                                e.target.value = ""; // Reset
                                              }
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const valInput = (e.target as HTMLInputElement).value;
                                                if (valInput) {
                                                  const url = cleanImageUrl(valInput);
                                                  const newOpts = [...(editingProduct.options || [])];
                                                  const images = { ...(newOpts[idx].images || {}) };
                                                  images[val] = url;
                                                  newOpts[idx] = { ...newOpts[idx], images };
                                                  setEditingProduct({...editingProduct, options: newOpts});
                                                  (e.target as HTMLInputElement).value = "";
                                                }
                                              }
                                            }}
                                          />
                                        </div>
                                      </div>
                                      {opt.images?.[val] && (
                                        <button 
                                          type="button"
                                          onClick={() => {
                                            const newOpts = [...(editingProduct.options || [])];
                                            const images = { ...(newOpts[idx].images || {}) };
                                            delete images[val];
                                            newOpts[idx] = { ...newOpts[idx], images };
                                            setEditingProduct({...editingProduct, options: newOpts});
                                          }}
                                          className="absolute top-2 right-2 p-1.5 bg-red-100 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        <button 
                          type="button"
                          onClick={() => {
                            const newOpts = [...(editingProduct.options || []), { name: "", values: [] }];
                            setEditingProduct({...editingProduct, options: newOpts});
                            setRawProductOptions([...rawProductOptions, ""]);
                          }}
                          className="w-full py-4 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 font-black text-xs uppercase tracking-widest hover:border-primary-light hover:text-primary-dark hover:bg-white transition-all flex items-center justify-center gap-2"
                        >
                          <Zap className="w-4 h-4" /> Thêm phân loại mới
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-6 pt-10 border-t border-gray-100">
                      <button 
                        type="button" 
                        onClick={() => {
                          setEditingProduct(null);
                          setRawProductOptions([]);
                        }} 
                        className="flex-1 py-6 rounded-[2rem] bg-gray-50 text-gray-400 font-black text-xl hover:bg-gray-100 transition-all font-sans"
                      >
                        Hủy bỏ 🐾
                      </button>
                      <button 
                        type="submit" 
                        className="flex-[2.5] py-6 rounded-[2rem] btn-primary text-xl shadow-2xl shadow-primary-dark/30 relative overflow-hidden group font-sans"
                      >
                        <span className="relative z-10">{editingProduct.id ? "Lưu thay đổi ✨" : "Thêm sản phẩm ✨"}</span>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                      </button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <>
          {/* Background Paw Prints Decoration */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0">
        {decorationPositions.map((pos, i) => (
          <div 
            key={i} 
            className="absolute"
            style={{ 
              top: pos.top, 
              left: pos.left,
              transform: `rotate(${pos.rotation}) scale(${pos.scale})`
            }}
          >
            <div className="w-10 h-10 bg-primary rounded-full mb-2 ml-5" />
            <div className="flex gap-2">
              <div className="w-8 h-8 bg-primary rounded-full" />
              <div className="w-8 h-8 bg-primary rounded-full" />
              <div className="w-8 h-8 bg-primary rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Top Bar */}
      <div className="bg-primary-dark text-white text-center py-2 text-xs sm:text-sm font-bold tracking-wide">
        🌸 CHÀO MỪNG BẠN ĐẾN VỚI THẾ GIỚI CUTE HANACHIBI! MIỄN PHÍ SHIP ĐƠN TỪ 200K • TẶNG 10 XU CHO MỖI 100K 🌸
      </div>

      {/* Header */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? "bg-white shadow-lg py-2" : "bg-white py-4"}`}>
        <div className="max-w-[1800px] mx-auto px-6">
          <div className="flex items-center justify-between gap-4 md:gap-8">
            {/* Logo Section */}
            <div className="flex items-center gap-4 cursor-pointer group shrink-0" onClick={() => {
              setSelectedCategory("all");
              setProductPage(null);
              const now = Date.now();
              const lastClick = (window as any)._lastLogoClick || 0;
              const count = (window as any)._logoClickCount || 0;
              if (now - lastClick < 500) {
                (window as any)._logoClickCount = count + 1;
                if (count + 1 >= 5) {
                  setShowAdminPasswordModal(true);
                  (window as any)._logoClickCount = 0;
                }
              } else {
                (window as any)._logoClickCount = 1;
              }
              (window as any)._lastLogoClick = now;
            }}>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white flex items-center justify-center rounded-2xl shadow-md group-hover:shadow-xl group-hover:scale-110 transition-all duration-500 overflow-hidden border-2 border-primary-light">
                <img src={cleanImageUrl(settings.logo)} alt="HanaChiBi" className="w-full h-full object-contain p-1.5" onError={(e) => (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi/200/200"} />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl md:text-2xl font-black text-primary-dark leading-none tracking-tight uppercase italic">HanaChiBi</h1>
              </div>
            </div>

            {/* Search Bar (Desktop) */}
            <div className="flex-grow max-w-2xl hidden md:block relative">
              <div className="flex items-center bg-gray-100 rounded-lg px-4 py-2 border-2 border-transparent focus-within:border-primary-dark/30 transition-all">
                <input 
                  type="text" 
                  placeholder="Tìm kiếm sản phẩm..." 
                  className="bg-transparent border-none focus:outline-none text-sm w-full font-medium"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value) setProductPage(null);
                  }}
                  onFocus={() => setShowSearchTrends(true)}
                  onBlur={() => setTimeout(() => setShowSearchTrends(false), 200)}
                />
                <Search className="w-5 h-5 text-gray-500 cursor-pointer" />
              </div>

              <AnimatePresence>
                {showSearchTrends && !searchQuery && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 z-[60]"
                  >
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Xu hướng tìm kiếm 🐾</h4>
                    <div className="flex flex-wrap gap-2">
                      {trendingKeywords.map(keyword => (
                        <button 
                          key={keyword}
                          onClick={() => setSearchQuery(keyword)}
                          className="px-4 py-2 bg-gray-50 hover:bg-primary-light/20 text-gray-600 hover:text-primary-dark rounded-xl text-xs font-bold transition-all"
                        >
                          {keyword}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Mobile Search Trigger */}
            <button 
              className="md:hidden p-2 text-gray-600 hover:text-primary-dark transition-colors"
              onClick={() => setShowMobileSearch(!showMobileSearch)}
            >
              <Search className="w-6 h-6" />
            </button>

            {/* Actions */}
            <div className="flex items-center gap-6 shrink-0">
              <div className="hidden lg:flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-light/20 rounded-full flex items-center justify-center text-primary-dark">
                  <Phone className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Hỗ trợ khách hàng</p>
                  <p className="text-sm font-black text-gray-900">039 6265 421</p>
                </div>
              </div>
              
              <div className="relative account-menu-container">
                <div 
                  className="flex items-center gap-3 cursor-pointer group"
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                >
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center group-hover:bg-primary-light transition-colors overflow-hidden border-2 border-transparent group-hover:border-primary-light">
                    {user?.avatar ? (
                      <img 
                        src={user.avatar} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random&color=fff&bold=true`;
                        }}
                      />
                    ) : (
                      <User className="w-5 h-5 text-gray-600" />
                    )}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-[10px] font-black text-gray-400 uppercase">{user ? 'Chào bạn,' : 'Tài khoản'}</p>
                    <p className="text-sm font-black text-gray-900">{user ? user.name : 'Đăng nhập'}</p>
                  </div>
                </div>

                <AnimatePresence>
                  {showAccountMenu && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
                    >
                      {user ? (
                        <div className="p-2">
                          <div className="px-4 py-2 border-b border-gray-50 mb-1">
                            <p className="text-[10px] font-black text-gray-400 uppercase">Đang đăng nhập</p>
                            <p className="text-sm font-black text-primary-dark truncate">{user.name}</p>
                          </div>
                          <div className="p-2 border-b border-gray-50 mb-1">
                            <label className="flex items-center gap-3 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-primary-light/20 rounded-xl transition-colors cursor-pointer">
                              <Upload className="w-4 h-4" /> Đổi ảnh đại diện
                              <input type="file" accept="image/*" onChange={handleUserAvatarUpload} className="hidden" />
                            </label>
                          </div>
                          <button 
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                          >
                            <X className="w-4 h-4" /> Đăng xuất
                          </button>
                        </div>
                      ) : (
                        <div className="p-2 space-y-1">
                          <button 
                            onClick={() => {
                              setAuthMode('login');
                              setShowLogin(true);
                              setShowAccountMenu(false);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-primary-light/20 rounded-xl transition-colors"
                          >
                            <User className="w-4 h-4" /> Đăng nhập
                          </button>
                          <button 
                            onClick={() => {
                              setAuthMode('register');
                              setShowLogin(true);
                              setShowAccountMenu(false);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-primary-light/20 rounded-xl transition-colors"
                          >
                            <Sparkles className="w-4 h-4" /> Đăng ký
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button 
                className="relative p-2 text-gray-600 hover:text-primary-dark transition-colors"
                onClick={() => setShowMyOrders(true)}
              >
                <Printer className="w-6 h-6" />
                <span className="hidden sm:block text-[10px] font-black text-gray-400 uppercase mt-1">Đơn hàng</span>
              </button>

              <button 
                className="relative p-2 text-gray-600 hover:text-primary-dark transition-colors"
                onClick={() => setShowCart(true)}
              >
                <ShoppingBag className="w-7 h-7" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                    {cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Mobile Search Bar */}
          <AnimatePresence>
            {showMobileSearch && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="md:hidden mt-4 overflow-hidden"
              >
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Tìm kiếm sản phẩm..." 
                    className="w-full pl-12 pr-4 py-3 bg-gray-100 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-light"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (e.target.value) setProductPage(null);
                    }}
                    autoFocus
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sub Nav */}
          <nav className="mt-4 border-t pt-4 flex items-center gap-4 overflow-x-auto no-scrollbar lg:gap-8">
            <button 
                onClick={() => {
                  setSelectedCategory("all");
                  setSelectedSubCategory("all");
                  setProductPage(null);
                }}
                className={`text-sm font-black uppercase tracking-wider flex items-center gap-3 transition-colors shrink-0 ${selectedCategory === "all" && !productPage ? 'text-primary-dark' : 'text-gray-600 hover:text-primary'}`}
              >
                <div className="w-6 h-6 bg-primary-light/20 rounded-lg flex items-center justify-center text-primary-dark">
                  <Home className="w-4 h-4" />
                </div>
                <span className="whitespace-nowrap">Trang chủ</span>
            </button>
            {categories.map(cat => (
              <button 
                key={cat.id} 
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setSelectedSubCategory("all");
                  setProductPage(null);
                }}
                className={`text-sm font-black uppercase tracking-wider flex items-center gap-3 transition-colors shrink-0 ${selectedCategory === cat.id ? 'text-primary-dark' : 'text-gray-600 hover:text-primary'}`}
              >
                {cat.image ? (
                  <img 
                    src={cleanImageUrl(cat.image)} 
                    className="w-6 h-6 rounded-lg object-cover border border-gray-100" 
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi/200/200";
                    }}
                  />
                ) : (
                  getIcon(cat.icon)
                )}
                <span className="whitespace-nowrap">{cat.name}</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${selectedCategory === cat.id ? 'rotate-90' : ''}`} />
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Breadcrumbs */}
      <div className="bg-gray-50 py-3 border-b">
        <div className="container mx-auto px-4 flex items-center gap-2 text-xs font-bold text-gray-400">
          <span className="hover:text-primary-dark cursor-pointer" onClick={() => { setSelectedCategory("all"); setSelectedSubCategory("all"); }}>Trang chủ</span>
          <ChevronRight className="w-3 h-3" />
          <span className="hover:text-primary-dark cursor-pointer" onClick={() => setSelectedSubCategory("all")}>
            {categories.find(c => c.id === selectedCategory)?.name || "Tất cả"}
          </span>
          {selectedSubCategory !== "all" && (
            <>
              <ChevronRight className="w-3 h-3" />
              <span className="hover:text-primary-dark cursor-pointer" onClick={() => setProductPage(null)}>{selectedSubCategory}</span>
            </>
          )}
          {productPage && (
            <>
              <ChevronRight className="w-3 h-3" />
              <span className="text-primary-dark line-clamp-1">{productPage.name}</span>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-grow">
        {productPage ? (
          <section className="py-8 bg-white">
            <div className="max-w-[1400px] mx-auto px-6">
              <button 
                onClick={() => setProductPage(null)}
                className="flex items-center gap-2 text-gray-500 hover:text-primary-dark font-bold mb-6 transition-colors group"
              >
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-primary-light transition-colors">
                  <ChevronRight className="w-4 h-4 rotate-180" />
                </div>
                Quay lại
              </button>

              <div className="flex flex-col lg:flex-row gap-8">
                {/* Image Gallery Column */}
                <div className="lg:w-1/2 space-y-8">
                  <div className="space-y-4">
                    <div className="aspect-square rounded-[3rem] overflow-hidden bg-gray-50 border-2 border-gray-50 shadow-sm relative group">
                      <button 
                        onClick={() => {
                          const imgs = [productPage.image, ...(productPage.images || [])].filter(Boolean);
                          if (imgs.length > 0) {
                            setProductPageImageIndex(prev => (prev - 1 + imgs.length) % imgs.length);
                            setSelectedQuickViewImage(null);
                          }
                        }}
                        className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-800 shadow-xl opacity-0 group-hover:opacity-100 transition-all z-10 hover:bg-white"
                      >
                        <ChevronRight className="w-6 h-6 rotate-180" />
                      </button>

                      <button 
                        onClick={() => {
                          const imgs = [productPage.image, ...(productPage.images || [])].filter(Boolean);
                          if (imgs.length > 0) {
                            setProductPageImageIndex(prev => (prev + 1) % imgs.length);
                            setSelectedQuickViewImage(null);
                          }
                        }}
                        className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center text-gray-800 shadow-xl opacity-0 group-hover:opacity-100 transition-all z-10 hover:bg-white"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>

                      <div className="w-full h-full relative overflow-hidden">
                        <AnimatePresence mode="wait">
                          {(() => {
                            const allImgs = [productPage.image, ...(productPage.images || [])];
                            const currentImg = selectedQuickViewImage || allImgs[productPageImageIndex % allImgs.length];
                            return (
                              <motion.img 
                                key={currentImg}
                                initial={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
                                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, scale: 0.95, filter: 'blur(5px)' }}
                                transition={{ 
                                  duration: 0.6, 
                                  ease: [0.33, 1, 0.68, 1] 
                                }}
                                src={cleanImageUrl(currentImg)} 
                                alt={productPage.name} 
                                className="w-full h-full object-contain p-8 select-none absolute inset-0"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi-detail/800/800";
                                }}
                              />
                            );
                          })()}
                        </AnimatePresence>
                      </div>
                      
                      <div className="absolute top-6 left-6 flex flex-col gap-3">
                        {productPage.isFlashSale && (
                          <span className="bg-red-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-xl flex items-center gap-2">
                            <Zap className="w-3 h-3 fill-current" /> Đang Sale
                          </span>
                        )}
                        {productPage.isNew && (
                          <span className="bg-primary-dark text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-xl">Hàng Mới</span>
                        )}
                      </div>

                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 overflow-hidden px-4 py-2 bg-black/10 backdrop-blur-md rounded-full">
                        {[productPage.image, ...(productPage.images || [])].map((img, i) => (
                          <div key={i} className={`w-2 h-2 rounded-full transition-all ${ (selectedQuickViewImage || [productPage.image, ...(productPage.images || [])][productPageImageIndex % [productPage.image, ...(productPage.images || [])].length]) === img ? 'w-6 bg-primary-dark' : 'bg-white'}`} />
                        ))}
                      </div>
                    </div>

                    {/* Thumbnails (Classification Images Only) */}
                    {(() => {
                      const classificationImages = (productPage.options || []).flatMap(opt => Object.values(opt.images || {}) as string[]);
                      if (classificationImages.length === 0) return null;
                      return (
                        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                          {classificationImages.map((img, idx) => (
                            <button 
                              key={idx}
                              onClick={() => {
                                setSelectedQuickViewImage(img);
                                setProductPageImageIndex(0); // Stop auto-slide focus
                              }}
                              className={`w-24 h-24 rounded-2xl overflow-hidden border-2 flex-shrink-0 transition-all ${selectedQuickViewImage === img ? 'border-primary-dark shadow-lg scale-105' : 'border-gray-100 hover:border-primary-light'}`}
                            >
                              <img src={cleanImageUrl(img)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Description and Details Moved here */}
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <h3 className="text-lg font-black text-gray-900 border-l-4 border-primary-dark pl-3 uppercase tracking-wider">Mô tả sản phẩm</h3>
                      <div className="bg-white p-6 rounded-[2rem] border-2 border-primary-light/20 shadow-sm relative overflow-hidden group">
                        <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary-light/10 rounded-full blur-3xl group-hover:bg-primary-light/20 transition-all" />
                        <p className="text-gray-700 font-bold leading-relaxed text-base whitespace-pre-wrap">
                          {productPage.description}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-lg font-black text-gray-900 border-l-4 border-primary-dark pl-3 uppercase tracking-wider">Thông số chi tiết</h3>
                      {productPage.details ? (
                         <div className="bg-white rounded-[2rem] p-6 border-2 border-primary-light/20 shadow-sm relative overflow-hidden">
                           <div className="absolute top-0 left-0 w-2 h-full bg-primary-dark opacity-10" />
                           <div className="text-base text-gray-700 whitespace-pre-wrap leading-relaxed font-bold pl-4">
                             {productPage.details}
                           </div>
                         </div>
                      ) : (
                        <div className="py-12 text-center bg-gray-50 rounded-[2.5rem] border-4 border-dashed border-white text-gray-400 font-bold italic">
                          Báo Hồng đang cập nhật thông số... Sẽ sớm thôi ạ! ~ 🌸
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info Column */}
                <div className="lg:w-1/2 flex flex-col">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 bg-primary-light/30 text-primary-dark text-[10px] font-black uppercase tracking-widest rounded-lg">
                      {categories.find(c => c.id === productPage.category)?.name}
                    </span>
                    <span className="text-gray-400 font-bold text-xs">Thương hiệu: <span className="text-gray-900">{productPage.brand || "HanaChiBi"}</span></span>
                  </div>

                  <h1 className="text-2xl md:text-4xl text-gray-900 mb-3 leading-[1.1] font-sans font-black tracking-tighter">{productPage.name}</h1>
                  
                  <div className="flex items-center gap-6 mb-4 pb-4 border-b border-gray-100">
                    <button 
                      onClick={() => {
                        document.getElementById('product-reviews')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="flex items-center gap-1 hover:opacity-70 transition-opacity"
                    >
                      {[1,2,3,4,5].map(s => <Star key={s} className="w-3 h-3 fill-yellow-400 text-yellow-400" />)}
                      <span className="text-xs font-bold text-gray-400 ml-2">4.9 ({productPage.reviewsList?.length || 0} đánh giá)</span>
                    </button>
                    <div className="h-4 w-[1px] bg-gray-200" />
                    <span className="text-xs font-bold text-gray-400">Đã bán: <span className="text-gray-900 font-black">{productPage.soldCount || 0}</span></span>
                  </div>

                  <div className="bg-gray-50 rounded-[2rem] p-6 mb-4 border border-gray-100">
                    <div className="flex items-baseline gap-4 mb-2">
                      <span className="text-4xl font-black text-primary-dark tracking-tighter">
                        {((productPage.purchaseMode === 'combo' && productPage.combos?.length ? (productPage.price * (productPageOptions['Combo'] ? parseInt(productPageOptions['Combo']) / Math.min(...productPage.combos) : 1)) : productPage.price) * productPageQuantity).toLocaleString('vi-VN')}đ
                      </span>
                      {productPage.originalPrice && (
                        <span className="text-lg text-gray-300 line-through font-bold">
                          {((productPage.purchaseMode === 'combo' && productPage.combos?.length ? (productPage.originalPrice * (productPageOptions['Combo'] ? parseInt(productPageOptions['Combo']) / Math.min(...productPage.combos) : 1)) : productPage.originalPrice) * productPageQuantity).toLocaleString('vi-VN')}đ
                        </span>
                      )}
                      {productPage.originalPrice && (
                        <span className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-md mb-2">
                          -{Math.round((1 - productPage.price / productPage.originalPrice) * 100)}%
                        </span>
                      )}
                    </div>
                    {productPage.purchaseMode === 'combo' && (
                      <p className="text-[10px] font-bold text-gray-400 italic mb-1 uppercase tracking-widest">* Giá combo thay đổi theo số lượng trong combo ✨</p>
                    )}
                    <div className="flex items-center gap-2 text-[10px] font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-xl border border-green-100 w-fit">
                      <Zap className="w-3 h-3 fill-current" /> Tiết kiệm ngay tới {((productPage.originalPrice || 0) - productPage.price > 0 ? ((productPage.originalPrice || 0) - productPage.price).toLocaleString('vi-VN') + 'đ' : 'cho bạn')}!
                    </div>
                  </div>

                  {/* Options */}
                  <div className="space-y-4 mb-4">
                    {productPage.purchaseMode === 'combo' && productPage.combos?.length && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">Chọn COMBO ✨</label>
                        <div className="flex flex-wrap gap-2">
                          {productPage.combos.sort((a,b) => a-b).map(c => (
                            <button 
                              key={c}
                              onClick={() => setProductPageOptions(prev => ({...prev, 'Combo': c.toString()}))}
                              className={`px-4 py-2.5 rounded-xl text-[10px] font-black transition-all border-2 ${productPageOptions['Combo'] === c.toString() ? 'bg-primary-dark text-white border-primary-dark shadow-lg scale-105' : 'bg-white text-gray-500 border-gray-100 hover:border-primary-light hover:bg-primary-light/10'}`}
                            >
                              Combo {c}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {productPage.options && productPage.options.length > 0 && (
                      productPage.options.map((opt, oIdx) => (
                        <div key={oIdx} className="space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">Chọn {opt.name}</label>
                          <div className="flex flex-wrap gap-2">
                            {opt.values.map(val => (
                              <button 
                                key={val}
                                onClick={() => {
                                  setProductPageOptions(prev => ({...prev, [opt.name]: val}));
                                  // Update image if variation has one
                                  if (opt.images?.[val]) {
                                    setSelectedQuickViewImage(opt.images[val]);
                                  }
                                }}
                                className={`px-4 py-2.5 rounded-xl text-[10px] font-black transition-all border-2 ${productPageOptions[opt.name] === val ? 'bg-primary-dark text-white border-primary-dark shadow-lg scale-105' : 'bg-white text-gray-500 border-gray-100 hover:border-primary-light hover:bg-primary-light/10'}`}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Quantity and Actions */}
                  <div className="space-y-5 bg-white p-6 rounded-[2.5rem] border-2 border-gray-50 shadow-sm mb-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-2 italic">Số lượng cần mua</label>
                        <div className="flex items-center bg-gray-50 rounded-2xl p-1 border border-gray-100">
                          <button 
                            onClick={() => setProductPageQuantity(q => Math.max(productPage.minQuantity || 1, q - 1))}
                            className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-primary-dark transition-colors"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input 
                            type="number"
                            value={productPageQuantity}
                            onChange={(e) => {
                              const v = parseInt(e.target.value);
                              if (!isNaN(v)) setProductPageQuantity(Math.max(productPage.minQuantity || 1, v));
                            }}
                            className="w-14 text-center bg-transparent font-black text-lg focus:outline-none"
                          />
                          <button 
                            onClick={() => setProductPageQuantity(q => q + 1)}
                            className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-primary-dark transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      {productPage.minQuantity && productPage.minQuantity > 1 && (
                        <div className="flex items-center gap-2.5 px-5 py-3 bg-primary-light/20 rounded-[1.5rem] border border-primary-light/50">
                          <Info className="w-4 h-4 text-primary-dark" />
                          <p className="text-[10px] font-black text-primary-dark uppercase italic leading-tight">
                            Sản phẩm này yêu cầu mua tối thiểu {productPage.minQuantity} cái
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button 
                         onClick={() => {
                           if (productPage.options?.some(opt => !productPageOptions[opt.name])) {
                             showAlert("Vui lòng chọn đầy đủ các phân loại nhé! 🌸", "info");
                             return;
                           }
                           addToCart(productPage, productPageOptions, productPageQuantity);
                         }}
                         className="flex-grow py-3.5 bg-white border-2 border-primary-dark text-primary-dark rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-primary-light/20 transition-all flex items-center justify-center gap-2 active:scale-95 shadow-sm text-xs"
                      >
                        <ShoppingBag className="w-4 h-4" /> Thêm vào giỏ
                      </button>
                      <button 
                         onClick={() => {
                           if (productPage.options?.some(opt => !productPageOptions[opt.name])) {
                             showAlert("Vui lòng chọn đầy đủ các phân loại nhé! 🌸", "info");
                             return;
                           }
                           handleBuyNow(productPage, productPageOptions, productPageQuantity);
                         }}
                         className="flex-grow py-3.5 bg-primary-dark text-white rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-black transition-all shadow-xl active:scale-95 text-xs"
                      >
                        Mua ngay ✨
                      </button>
                    </div>

                    {/* Trust Badges Compact */}
                    <div className="pt-4 border-t border-gray-50 grid grid-cols-3 gap-2">
                      {[
                        { icon: ShieldCheck, text: "Chính hãng", color: "text-blue-500" },
                        { icon: Truck, text: "Giao nhanh", color: "text-green-500" },
                        { icon: RotateCcw, text: "Đổi trả 7 ngày", color: "text-orange-500" }
                      ].map((badge, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 bg-gray-50/50 rounded-xl border border-gray-100 shadow-sm">
                          <badge.icon className={`w-3 h-3 ${badge.color}`} />
                          <span className="text-[9px] font-black text-gray-700 uppercase tracking-tighter truncate">{badge.text}</span>
                        </div>
                      ))}
                    </div>

                    {/* Reviews Moved here */}
                    <div id="product-reviews" className="mt-8 space-y-6">
                        <h3 className="text-lg font-black text-gray-900 border-l-4 border-primary-dark pl-3 uppercase tracking-wider">Đánh giá từ khách hàng</h3>
                        
                        {/* Write Review Section */}
                        <div className="bg-white p-6 rounded-[2rem] border-2 border-primary-light/10 shadow-sm space-y-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary-light/30 rounded-xl flex items-center justify-center text-primary-dark">
                              <Star className="w-5 h-5 fill-current" />
                            </div>
                            <h4 className="text-base font-black text-gray-900">Gửi lời yêu thương 🎀</h4>
                          </div>
                          
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-2xl w-fit">
                              {[1,2,3,4,5].map(s => (
                                <button key={s} onClick={() => setReviewRating(s)} className={`p-1.5 rounded-lg transition-all ${reviewRating >= s ? 'bg-yellow-400 text-white shadow-md' : 'bg-white text-gray-300'}`}>
                                  <Star className={`w-4 h-4 ${reviewRating >= s ? 'fill-current' : ''}`} />
                                </button>
                              ))}
                            </div>
                            
                            <div className="relative group">
                              <textarea 
                                value={reviewComment}
                                onChange={e => setReviewComment(e.target.value)}
                                placeholder="Nhập cảm nhận của bạn nhé... ✨"
                                className="w-full px-6 py-4 rounded-3xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none font-bold h-24 resize-none transition-all shadow-sm text-sm"
                              />
                            </div>
                            
                            <div className="flex flex-col gap-4">
                              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                {reviewImages.map((img, i) => (
                                  <div key={i} className="relative w-16 h-16 rounded-xl border border-gray-100 overflow-hidden shrink-0 shadow-sm">
                                    <img src={cleanImageUrl(img)} className="w-full h-full object-cover" />
                                    <button onClick={() => setReviewImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-bl-lg">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                                <div className="relative w-16 h-16 rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 hover:border-primary transition-all shrink-0">
                                  {isUploading ? <Sparkles className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                                  <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        setIsUploading(true);
                                        try {
                                          const url = await uploadImage(file, "reviews");
                                          setReviewImages(prev => [...prev, url]);
                                        } finally {
                                          setIsUploading(false);
                                        }
                                      }
                                    }}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                  />
                                </div>
                              </div>
                              <button 
                                onClick={handleSubmitReview}
                                className="w-full py-4 btn-primary shadow-xl text-sm"
                              >
                                Gửi đánh giá ngay ✨
                              </button>
                            </div>
                            {!user && <p className="text-[10px] text-center text-red-400 font-black uppercase tracking-widest italic flex items-center justify-center gap-2">
                              <Info className="w-3 h-3" /> Bạn cần đăng nhập nhé 🐾
                            </p>}
                          </div>
                        </div>

                        {/* Recent Reviews List */}
                        <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                          {(productPage.reviewsList || []).length > 0 ? (
                            productPage.reviewsList.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(review => (
                              <div key={review.id} className="p-6 bg-white rounded-3xl border border-gray-50 shadow-sm space-y-4">
                                <div className="flex justify-between items-start">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-primary-light/50 rounded-full flex items-center justify-center text-primary-dark font-black shadow-sm border-2 border-white text-sm">
                                      {review.userName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="font-black text-gray-900 text-xs">{review.userName}</p>
                                      <div className="flex items-center gap-1 mt-0.5">
                                        {[...Array(5)].map((_, i) => (
                                          <Star key={i} className={`w-3 h-3 ${i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-100'}`} />
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-bold text-gray-300 italic">{new Date(review.createdAt).toLocaleDateString('vi-VN')}</span>
                                </div>
                                <p className="text-gray-600 font-bold leading-relaxed italic text-sm">"{review.comment}"</p>
                                {review.images && review.images.length > 0 && (
                                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                    {review.images.map((img, i) => (
                                      <div key={i} className="w-16 h-16 rounded-xl overflow-hidden border border-gray-50 shadow-sm shrink-0">
                                        <img src={cleanImageUrl(img)} className="w-full h-full object-cover" />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="py-20 text-center space-y-4 bg-gray-50 rounded-[3rem] border-2 border-dashed border-white">
                              <Sparkles className="w-10 h-10 animate-pulse mx-auto text-primary-light" />
                              <p className="text-gray-400 font-black italic uppercase tracking-widest text-[10px]">Chưa có đánh giá nào... ✨</p>
                            </div>
                          )}
                        </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Related Products Section or other content */}
              <div className="mt-20">
                {/* Potentially Add Related Products here */}
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* Hero Slider Section (Moving Banner) - Only shown when logged in */}
        {user && selectedCategory === "all" && !searchQuery && (
          <section className="relative overflow-hidden bg-white">
            <div className="relative h-[400px] md:h-[600px]">
              <div className="w-full h-full overflow-hidden relative bg-gray-50">
                {bannerSlides.length > 0 ? (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={safeCurrentSlide}
                      initial={{ opacity: 0, x: 100 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ duration: 0.8, ease: "easeInOut" }}
                      className="absolute inset-0"
                    >
                      <div className="relative w-full h-full">
                        <img 
                          src={cleanImageUrl(bannerSlides[safeCurrentSlide]?.banner || bannerSlides[safeCurrentSlide]?.image || `https://picsum.photos/seed/${bannerSlides[safeCurrentSlide]?.id}-hero/1920/800`)} 
                          alt={bannerSlides[safeCurrentSlide]?.name}
                          className="w-full h-full object-cover object-center"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${bannerSlides[safeCurrentSlide]?.id}-hero/1920/800`;
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="text-center px-4">
                            <motion.div
                              initial={{ y: 30, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ delay: 0.3 }}
                            >
                              <h2 className="text-4xl md:text-7xl font-black text-white mb-6 uppercase tracking-tighter italic drop-shadow-2xl">
                                {bannerSlides[safeCurrentSlide]?.name}
                              </h2>
                              <button 
                                onClick={() => setSelectedCategory(bannerSlides[safeCurrentSlide]?.id)}
                                className="px-10 py-3.5 bg-white text-gray-900 rounded-full font-black text-xs md:text-sm uppercase tracking-widest hover:bg-primary-light hover:text-primary-dark transition-all shadow-2xl hover:scale-110 active:scale-95"
                              >
                                Khám phá ngay
                              </button>
                            </motion.div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100">
                    <div className="text-center">
                      <Sparkles className="w-12 h-12 text-primary-dark mx-auto mb-4 animate-bounce" />
                      <p className="text-gray-400 font-black uppercase tracking-widest">Đang tải banner... 🐾</p>
                    </div>
                  </div>
                )}

                {bannerSlides.length > 1 && (
                  <>
                    {/* Slider Indicators */}
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-3 z-20">
                      {bannerSlides.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentSlide(index)}
                          className={`h-2 rounded-full transition-all duration-500 ${safeCurrentSlide === index ? 'w-12 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'}`}
                        />
                      ))}
                    </div>

                    {/* Navigation Arrows */}
                    <button 
                      onClick={() => setCurrentSlide((prev) => (prev - 1 + bannerSlides.length) % bannerSlides.length)}
                      className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all z-20 border border-white/30"
                    >
                      <ChevronRight className="w-6 h-6 rotate-180" />
                    </button>
                    <button 
                      onClick={() => setCurrentSlide((prev) => (prev + 1) % bannerSlides.length)}
                      className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all z-20 border border-white/30"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Welcome Section (Static Banner - only shown when not logged in and no search) */}
        {!user && selectedCategory === "all" && !searchQuery && (
          <section className="relative overflow-hidden bg-white">
            <div className="relative h-[400px] md:h-[600px]">
              <div className="w-full h-full overflow-hidden relative">
                <img 
                  src={cleanImageUrl(settings.loginBanner)} 
                  alt="HanaChiBi Banner" 
                  className="w-full h-full object-cover object-center"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi-main/1000/800";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/50 to-transparent flex items-center">
                  <div className="w-full px-8 md:px-16 lg:px-20">
                    <motion.div
                      initial={{ x: -30, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.3 }}
                      className="text-left max-w-4xl"
                    >
                      <div className="mb-8">
                        <h2 className="text-4xl md:text-6xl font-black text-[#c5b4e3] leading-[1.1] tracking-tight drop-shadow-sm whitespace-pre-wrap max-w-xl">
                          {settings.loginBannerText || "Cùng HanaChiBi viết nên ước mơ"}
                        </h2>
                      </div>
                      
                      <p className="text-gray-500 font-semibold text-base md:text-lg mb-10 max-w-md leading-relaxed opacity-80">
                        Khám phá bộ sưu tập văn phòng phẩm pastel ngọt <br className="hidden md:block" />
                        ngào, chất lượng vượt trội dành riêng cho các bạn học <br className="hidden md:block" />
                        sinh, sinh viên.
                      </p>

                      <button 
                        onClick={() => setShowLogin(true)}
                        className="px-12 py-4.5 bg-[#ffb7c5] text-white rounded-full font-black text-base uppercase tracking-widest hover:bg-[#ff8fa3] transition-all hover:scale-105 active:scale-95 shadow-xl shadow-pink-200/50 flex items-center gap-2"
                      >
                        KHÁM PHÁ NGAY ✨
                      </button>
                    </motion.div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}


        {/* Flash Sale Section */}
        {selectedCategory === "all" && !searchQuery && (
          <section className="py-12 bg-white relative overflow-hidden">
            <div className="max-w-[1800px] mx-auto px-6">
              <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-[3rem] p-8 md:p-12 border-2 border-red-100 shadow-2xl relative overflow-hidden">
                <div className="flex flex-col items-center justify-center mb-10 gap-8 relative z-10">
                  <div className="flex flex-col items-center text-center">
                    <h3 className="text-5xl md:text-7xl font-black text-red-600 italic tracking-tighter flex items-center gap-4 mb-2">
                      <Zap className="w-12 h-12 md:w-16 md:h-16 fill-current animate-pulse" /> FLASH SALE
                    </h3>
                    <div className="flex flex-col md:flex-row items-center gap-4">
                      <p className="text-sm font-black text-red-400 uppercase tracking-widest">Kết thúc sau:</p>
                      <div className="flex gap-2">
                        {[timeLeft.hours, timeLeft.minutes, timeLeft.seconds].map((unit, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="w-14 h-14 bg-red-600 rounded-2xl flex items-center justify-center font-black text-2xl text-white shadow-xl border border-white/20">
                              {unit.toString().padStart(2, '0')}
                            </div>
                            {i < 2 && <span className="text-2xl font-black text-red-600">:</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button className="px-10 py-4 bg-red-600 text-white rounded-full font-black text-sm hover:bg-red-700 transition-all shadow-xl flex items-center gap-3 group">
                    Xem tất cả <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-8">
                  {(hasLoadedProducts && liveProducts.length > 0 ? liveProducts.filter(p => p.isFlashSale) : FLASH_SALE_PRODUCTS).slice(0, 5).map((product) => (
                    <div key={product.id} className="bg-white rounded-[2.5rem] p-5 shadow-xl relative group hover:-translate-y-2 transition-all duration-500 border-2 border-transparent hover:border-red-200">
                      {product.originalPrice && product.price < product.originalPrice && (
                        <div className="absolute top-4 right-4 z-10 bg-red-600 text-white font-black text-xs px-3 py-1 rounded-xl shadow-lg">
                          -{Math.round((1 - product.price / product.originalPrice) * 100)}%
                        </div>
                      )}
                      <div className="aspect-square rounded-[2rem] overflow-hidden mb-6 bg-gray-50 relative">
                        <img 
                          src={cleanImageUrl(product.image)} 
                          alt={product.name} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "https://picsum.photos/seed/placeholder-prod/600/600";
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button 
                            onClick={() => openQuickView(product)}
                            className="w-12 h-12 bg-white text-red-600 rounded-2xl flex items-center justify-center hover:scale-110 transition-transform shadow-xl"
                            title="Xem nhanh"
                          >
                            <Eye className="w-6 h-6" />
                          </button>
                          <button 
                            onClick={() => handleAddToCartClick(product)}
                            className="w-12 h-12 bg-red-600 text-white rounded-2xl flex items-center justify-center hover:scale-110 transition-transform shadow-xl"
                            title="Thêm vào giỏ"
                          >
                            <ShoppingCart className="w-6 h-6" />
                          </button>
                        </div>
                      </div>
                      <h4 className="font-bold text-gray-800 text-sm mb-2 line-clamp-1 group-hover:text-red-600 transition-colors">{product.name}</h4>
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-xl font-black text-red-600">{product.price.toLocaleString('vi-VN')}đ</span>
                        {product.originalPrice && (
                          <span className="text-xs text-gray-400 line-through font-bold">{product.originalPrice.toLocaleString('vi-VN')}đ</span>
                        )}
                      </div>
                      <div className="h-4 bg-red-100 rounded-full overflow-hidden relative">
                        <div 
                          className="h-full bg-gradient-to-r from-red-500 to-orange-500"
                          style={{ width: `${Math.max(20, ((product.soldCount || 0) / (product.totalStock || 100)) * 100)}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[10px] font-black text-white uppercase tracking-tighter">
                            {((product.soldCount || 0) / (product.totalStock || 100)) * 100 > 80 ? 'Sắp cháy 🔥' : `Đã bán ${product.soldCount || 0}`}
                          </span>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          if ((product.options && product.options.length > 0) || product.purchaseMode === 'combo') {
                            openQuickView(product);
                          } else {
                            addToCart(product);
                            if (!user) {
                              showAlert("Opps! Bạn cần đăng nhập để có thể đặt hàng nhé 🌸", "info");
                              setShowLogin(true);
                              return;
                            }
                            setShowCheckout(true);
                          }
                        }}
                        className="w-full mt-6 py-3 bg-red-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0"
                      >
                        Đặt hàng ngay
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Products Section */}
        <section className="py-12 bg-white">
          <div className="max-w-[1800px] mx-auto px-6">
            {selectedCategory === "all" && !searchQuery ? (
              /* Home Layout: Full-width framed categories matching Flash Sale */
              <div className="space-y-24">
                {categories.filter(c => c.id !== 'all').map(category => {
                  const categoryProducts = (hasLoadedProducts && liveProducts.length > 0 ? liveProducts : PRODUCTS)
                    .filter(p => p.category === category.id)
                    .slice(0, 5);

                  return (
                    <div key={category.id} className="bg-gray-50/50 rounded-[3rem] p-8 md:p-12 border-2 border-gray-100 shadow-xl relative overflow-hidden">
                      <div className="space-y-12">
                        {/* Category Banner - Framed like Flash Sale */}
                        <div className="relative h-[250px] md:h-[450px] rounded-[2rem] overflow-hidden group shadow-lg">
                          <img 
                            src={cleanImageUrl(category.banner || category.image || `https://picsum.photos/seed/${category.id}-banner/1200/400`)} 
                            alt={category.name} 
                            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-1000"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${category.id}-banner/1200/400`;
                            }}
                          />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center px-6">
                            <div className="text-center">
                              <h3 className="text-4xl md:text-7xl font-black text-white mb-8 uppercase tracking-tight italic drop-shadow-2xl">
                                {category.name}
                              </h3>
                              <button 
                                onClick={() => setSelectedCategory(category.id)}
                                className="px-12 py-4 bg-white text-gray-900 rounded-full font-black text-sm uppercase tracking-widest hover:bg-primary-light hover:text-primary-dark transition-all shadow-2xl hover:scale-110 active:scale-95"
                              >
                                Khám phá ngay
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Sub-categories & Products */}
                        <div className="space-y-8">
                          <div className="flex items-center justify-between border-b-2 border-gray-100 pb-4">
                            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                              <button 
                                onClick={() => setSelectedCategory(category.id)}
                                className="px-6 py-2 bg-primary-dark text-white rounded-full text-xs font-black uppercase tracking-widest shadow-lg"
                              >
                                Sản phẩm HOT
                              </button>
                              {category.subCategories.map(sub => (
                                <button 
                                  key={sub}
                                  onClick={() => {
                                    setSelectedCategory(category.id);
                                    setSelectedSubCategory(sub);
                                  }}
                                  className="px-6 py-2 bg-white border-2 border-gray-100 text-gray-400 rounded-full text-xs font-black uppercase tracking-widest hover:border-primary-light hover:text-primary-dark transition-all whitespace-nowrap"
                                >
                                  {sub}
                                </button>
                              ))}
                            </div>
                            <button 
                              onClick={() => setSelectedCategory(category.id)}
                              className="text-xs font-black text-primary-dark uppercase tracking-widest hover:underline underline-offset-4"
                            >
                              Xem tất cả
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                            {categoryProducts.map((product) => (
                              <div key={product.id} className="bg-white rounded-[2rem] p-4 border-2 border-gray-50 hover:border-primary-light/30 transition-all group flex flex-col h-full shadow-sm hover:shadow-xl relative overflow-hidden">
                                <div className="relative aspect-square rounded-[1.5rem] overflow-hidden mb-4 bg-gray-50">
                                  <img 
                                    src={cleanImageUrl(product.image)} 
                                    alt={product.name} 
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = "https://picsum.photos/seed/placeholder-prod/600/600";
                                    }}
                                  />
                                </div>
                                <h4 className="font-bold text-gray-800 mb-1 line-clamp-1 text-xs group-hover:text-primary-dark transition-colors">{product.name}</h4>
                                <div className="flex items-center justify-between mt-auto">
                                  <span className="text-lg font-black text-primary-dark">{product.price.toLocaleString('vi-VN')}đ</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-12">
                {/* Sidebar Filters */}
                {selectedCategory !== "all" && !searchQuery && (
                <aside className="w-full lg:w-64 shrink-0 space-y-10">
                  <div>
                    <h4 className="text-sm font-black text-primary-dark uppercase tracking-widest mb-6 border-b-2 border-primary-light pb-2">Loại sản phẩm</h4>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="radio" 
                          name="subcategory"
                          checked={selectedSubCategory === "all"}
                          onChange={() => setSelectedSubCategory("all")}
                          className="w-5 h-5 accent-primary-dark" 
                        />
                        <span className={`text-sm font-bold transition-colors ${selectedSubCategory === "all" ? 'text-primary-dark' : 'text-gray-500 group-hover:text-primary'}`}>
                          {selectedCategory === "all" ? "Tất cả sản phẩm" : `Tất cả ${categories.find(c => c.id === selectedCategory)?.name}`}
                        </span>
                      </label>
                      {Array.from(new Set(selectedCategory === "all" 
                        ? categories.flatMap(c => c.subCategories || [])
                        : categories.find(c => c.id === selectedCategory)?.subCategories || []
                      )).map(sub => (
                        <label key={sub} className="flex items-center gap-3 cursor-pointer group">
                          <input 
                            type="radio" 
                            name="subcategory"
                            checked={selectedSubCategory === sub}
                            onChange={() => setSelectedSubCategory(sub)}
                            className="w-5 h-5 accent-primary-dark" 
                          />
                          <span className={`text-sm font-bold transition-colors ${selectedSubCategory === sub ? 'text-primary-dark' : 'text-gray-500 group-hover:text-primary'}`}>{sub}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-black text-primary-dark uppercase tracking-widest mb-6 border-b-2 border-primary-light pb-2">Thương hiệu</h4>
                    <div className="space-y-3">
                      {["Thiên Long", "Flexoffice", "Điểm 10", "Colokit", "HanaChiBi"].map(brand => (
                        <label key={brand} className="flex items-center gap-3 cursor-pointer group">
                          <input 
                            type="checkbox" 
                            checked={selectedBrands.includes(brand)}
                            onChange={() => toggleBrand(brand)}
                            className="w-5 h-5 accent-primary-dark" 
                          />
                          <span className={`text-sm font-bold transition-colors ${selectedBrands.includes(brand) ? 'text-primary-dark' : 'text-gray-500 group-hover:text-primary'}`}>{brand}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-black text-primary-dark uppercase tracking-widest mb-6 border-b-2 border-primary-light pb-2">Mức giá</h4>
                    <div className="space-y-3">
                      {[
                        { label: "Tất cả mức giá", range: null },
                        { label: "Dưới 20.000đ", range: [0, 20000] },
                        { label: "20.000đ - 50.000đ", range: [20000, 50000] },
                        { label: "50.000đ - 100.000đ", range: [50000, 100000] },
                        { label: "Trên 100.000đ", range: [100000, 1000000] }
                      ].map((item, i) => (
                        <label key={i} className="flex items-center gap-3 cursor-pointer group">
                          <input 
                            type="radio" 
                            name="priceRange"
                            checked={JSON.stringify(priceRange) === JSON.stringify(item.range)}
                            onChange={() => setPriceRange(item.range as [number, number] | null)}
                            className="w-5 h-5 accent-primary-dark" 
                          />
                          <span className={`text-sm font-bold transition-colors ${JSON.stringify(priceRange) === JSON.stringify(item.range) ? 'text-primary-dark' : 'text-gray-500 group-hover:text-primary'}`}>
                            {item.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </aside>
              )}

              {/* Main Products Area */}
              <div className="flex-grow">
                {selectedCategory !== "all" && !searchQuery && categories.find(c => c.id === selectedCategory) && (
                  <div className="relative h-[200px] md:h-[350px] rounded-[3rem] overflow-hidden mb-12 shadow-xl border-2 border-primary-light/10">
                    <img 
                      src={cleanImageUrl(categories.find(c => c.id === selectedCategory)?.banner || categories.find(c => c.id === selectedCategory)?.image || `https://picsum.photos/seed/${selectedCategory}-header/1200/400`)} 
                      alt={categories.find(c => c.id === selectedCategory)?.name} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${selectedCategory}-header/1200/400`;
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-8 md:p-12">
                      <h2 className="text-3xl md:text-5xl font-black text-white uppercase italic tracking-tight drop-shadow-lg">
                        {categories.find(c => c.id === selectedCategory)?.name}
                      </h2>
                      {selectedSubCategory !== "all" && (
                        <p className="text-white/80 font-black text-sm md:text-lg uppercase tracking-widest mt-2 flex items-center gap-2">
                           <ChevronRight className="w-4 h-4 md:w-5 md:h-5 text-primary-light" /> {selectedSubCategory}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
                  <h3 className="text-3xl font-black text-gray-900 uppercase italic">
                    {searchQuery ? `Kết quả tìm kiếm cho: "${searchQuery}"` : (categories.find(c => c.id === selectedCategory)?.name || "Danh mục")}
                  </h3>
                  <div className="flex items-center gap-4 overflow-x-auto pb-2 md:pb-0">
                    <span className="text-xs font-black text-gray-400 uppercase whitespace-nowrap">Sắp xếp:</span>
                    {[
                      { id: 'name-asc', label: 'Tên A → Z' },
                      { id: 'name-desc', label: 'Tên Z → A' },
                      { id: 'price-asc', label: 'Giá tăng dần' },
                      { id: 'price-desc', label: 'Giá giảm dần' },
                      { id: 'newest', label: 'Hàng mới' }
                    ].map(sort => (
                      <button 
                        key={sort.id}
                        onClick={() => setSortBy(sort.id as any)}
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${sortBy === sort.id ? 'bg-primary-dark text-white shadow-lg' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                      >
                        {sort.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                  {filteredProducts.map((product) => (
                    <div key={product.id} className="bg-white rounded-[2.5rem] p-6 border-2 border-gray-50 hover:border-primary-light shadow-sm hover:shadow-2xl transition-all group flex flex-col h-full relative overflow-hidden">
                      {/* Status Tags */}
                      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                        {product.isFlashSale && (
                          <span className="bg-red-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter flex items-center gap-1 shadow-lg">
                            <Zap className="w-3 h-3 fill-current" /> SALE
                          </span>
                        )}
                        {product.isNew && (
                          <span className="bg-primary-dark text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter shadow-lg">NEW</span>
                        )}
                      </div>

                      <div 
                        className="relative aspect-square rounded-[2rem] overflow-hidden mb-6 bg-gray-50 cursor-pointer group/img"
                        onClick={() => {
                          setProductPage(product);
                          setProductPageQuantity(product.minQuantity || 1);
                          setProductPageOptions({});
                          setSelectedQuickViewImage(null); // Reset to allow auto-slide to start
                          window.scrollTo(0, 0);
                        }}
                      >
                        <img 
                          src={cleanImageUrl(product.image) || "https://picsum.photos/seed/pink-panther/400/400"} 
                          alt={product.name} 
                          className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-700" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            if (!target.src.includes("pink-panther")) {
                              target.src = "https://picsum.photos/seed/pink-panther/400/400";
                            }
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              openQuickView(product);
                            }}
                            className="w-12 h-12 bg-white text-gray-900 rounded-2xl flex items-center justify-center hover:scale-110 transition-transform shadow-xl"
                          >
                            <Eye className="w-6 h-6" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddToCartClick(product);
                            }}
                            className="w-12 h-12 bg-primary-dark text-white rounded-2xl flex items-center justify-center hover:scale-110 transition-transform shadow-xl"
                          >
                            <ShoppingCart className="w-6 h-6" />
                          </button>
                        </div>
                      </div>

                      <div className="flex-grow">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-black text-primary-dark uppercase tracking-widest px-2 py-0.5 bg-primary-light/30 rounded-md">
                            {categories.find(c => c.id === product.category)?.name}
                          </span>
                          <span className="text-[10px] font-bold text-gray-400 capitalize">{product.brand}</span>
                        </div>
                        <h4 
                          className="product-name-elegant text-gray-900 mb-1 line-clamp-2 text-base hover:text-primary-dark transition-colors cursor-pointer"
                          onClick={() => {
                            setProductPage(product);
                            setProductPageQuantity(product.minQuantity || 1);
                            setProductPageOptions({});
                            setSelectedQuickViewImage(null); // Reset to allow auto-slide to start
                            window.scrollTo(0, 0);
                          }}
                        >
                          {product.name}
                        </h4>
                        
                        <div className="flex items-center gap-1 mb-4">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          ))}
                          <span className="text-[10px] text-gray-400 font-bold ml-1">(48)</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50">
                        <div className="flex flex-col">
                          {product.originalPrice && (
                            <span className="text-xs text-gray-400 line-through font-bold">
                              {product.originalPrice.toLocaleString('vi-VN')}đ
                            </span>
                          )}
                          <span className="text-xl font-black text-primary-dark tracking-tighter">{product.price.toLocaleString('vi-VN')}đ</span>
                        </div>
                        <button 
                          onClick={() => {
                            handleBuyNowClick(product);
                          }}
                          className="bg-primary-dark text-white px-6 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
                        >
                          Mua ngay
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {filteredProducts.length === 0 && (
                  <div className="text-center py-20 bg-gray-50 rounded-[4rem] border-2 border-dashed border-gray-200">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl">
                      <Sparkles className="w-10 h-10 text-gray-200" />
                    </div>
                    <p className="text-gray-400 font-black uppercase tracking-widest">Không tìm thấy sản phẩm phù hợp 🐾</p>
                    <button 
                      onClick={() => {
                        setSelectedCategory("all");
                        setSearchQuery("");
                        setPriceRange(null);
                      }}
                      className="mt-6 text-primary-dark font-black uppercase text-xs tracking-widest hover:underline"
                    >
                      Thiết lập lại bộ lọc
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

        {/* Why Choose Us */}
        <section className="py-32 bg-white relative overflow-hidden">
          <div className="container mx-auto px-4">
            <div className="text-center mb-20">
              <h3 className="text-4xl font-black text-gray-900 mb-4 tracking-tight">Tại Sao Chọn HanaChiBi?</h3>
              <p className="text-primary/60 font-bold uppercase tracking-[0.3em] text-xs">Cam kết chất lượng từ tâm</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              {[
                { title: "Thiết kế độc quyền", desc: "Sản phẩm mang đậm phong cách Pink Panther & HanaChiBi.", icon: Sparkles, color: "bg-pastel-pink" },
                { title: "Chất lượng cao cấp", desc: "Tuyển chọn kỹ lưỡng từ những nhà cung cấp uy tín nhất.", icon: Star, color: "bg-pastel-yellow" },
                { title: "Giao hàng siêu tốc", desc: "Nhận hàng trong vòng 2h tại khu vực nội thành.", icon: ShoppingBag, color: "bg-pastel-blue" }
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center text-center p-12 rounded-[4rem] bg-gray-50 hover:bg-white hover:shadow-2xl transition-all duration-500 group border-2 border-transparent hover:border-primary-light/20">
                  <div className={`w-24 h-24 ${item.color} rounded-[2rem] flex items-center justify-center mb-8 shadow-lg group-hover:rotate-12 transition-transform`}>
                    <item.icon className="w-10 h-10 text-primary-dark" />
                  </div>
                  <h4 className="text-xl font-black text-gray-900 mb-4">{item.title}</h4>
                  <p className="text-gray-500 font-medium leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Newsletter */}
        <section className="py-32 bg-primary-dark relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <div className="absolute top-10 left-10 w-20 h-20 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-40 h-40 bg-white rounded-full blur-3xl" />
          </div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-md rounded-[4rem] p-12 md:p-20 text-center border border-white/20">
              <h3 className="text-4xl md:text-5xl font-black text-white mb-8 tracking-tight">Nhận Ưu Đãi Từ Báo Hồng! 🐾</h3>
              <p className="text-white/80 text-lg mb-12 font-medium">Đăng ký nhận tin để không bỏ lỡ các bộ sưu tập mới và mã giảm giá độc quyền.</p>
              <form className="flex flex-col md:flex-row gap-4 max-w-2xl mx-auto">
                <input 
                  type="email" 
                  placeholder="Email của bạn..." 
                  className="flex-grow px-10 py-5 rounded-full bg-white/10 border-2 border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-white transition-all font-bold"
                />
                <button className="px-12 py-5 rounded-full bg-white text-primary-dark font-black hover:scale-105 transition-all shadow-xl">
                  Đăng ký ngay
                </button>
              </form>
            </div>
          </div>
        </section>
      </>
    )}
  </main>

      {/* Login Modal */}
      <AnimatePresence>
        {showLogin && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLogin(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }} 
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative w-full max-w-sm bg-white rounded-[3rem] shadow-2xl p-8 max-h-[90vh] overflow-y-auto custom-scrollbar"
              >
              <button onClick={() => setShowLogin(false)} className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full transition-all">
                <X className="w-6 h-6" />
              </button>
              <div className="text-center mb-10">
                <div className="w-28 h-28 bg-white rounded-full flex items-center justify-center mx-auto mb-6 overflow-hidden border-4 border-primary-light shadow-xl p-1">
                  <div className="w-full h-full rounded-full overflow-hidden bg-white border-2 border-primary-light/20">
                    <img 
                      key={settings.mascotImage} 
                      src={cleanImageUrl(settings.mascotImage)} 
                      className="w-full h-full object-contain p-2" 
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://picsum.photos/seed/pink-panther/400/400";
                      }}
                    />
                  </div>
                </div>
                <h3 className="text-2xl font-black text-gray-900">{authMode === 'login' ? 'Chào mừng trở lại!' : 'Tạo tài khoản mới ✨'}</h3>
                <p className="text-gray-400 font-bold mt-2">{authMode === 'login' ? settings.mascotText : 'Tham gia cộng đồng HanaChiBi ngay hôm nay! 🐾'}</p>
              </div>
              <form className="space-y-4" onSubmit={handleAuth}>
                {authMode === 'register' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-4">Họ và tên</label>
                      <input 
                        type="text" 
                        required
                        value={loginForm.name}
                        onChange={e => setLoginForm({...loginForm, name: e.target.value})}
                        className="w-full px-6 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none font-bold transition-all text-sm" 
                        placeholder="Nguyễn Văn A" 
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-4">
                    {authMode === 'login' ? 'Đăng nhập bằng Email' : 'Email'}
                  </label>
                  <input 
                    type="email" 
                    required
                    value={loginForm.email}
                    onChange={e => setLoginForm({...loginForm, email: e.target.value})}
                    className="w-full px-6 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none font-bold transition-all text-sm" 
                    placeholder="example@gmail.com" 
                  />
                </div>
                <div className="relative">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-4">Mật khẩu</label>
                  <input 
                    type={showPassword ? "text" : "password"} 
                    required
                    value={loginForm.password}
                    onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                    className="w-full px-6 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none font-bold transition-all text-sm pr-12" 
                    placeholder="••••••••" 
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 bottom-3.5 text-gray-400 hover:text-primary-dark transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {authMode === 'register' && (
                  <div className="relative">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-4">Xác nhận mật khẩu</label>
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      required 
                      value={loginForm.confirmPassword}
                      onChange={e => setLoginForm({...loginForm, confirmPassword: e.target.value})}
                      className="w-full px-6 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none font-bold transition-all text-sm pr-12" 
                      placeholder="••••••••" 
                    />
                    <button 
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-4 bottom-3.5 text-gray-400 hover:text-primary-dark transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                )}
                
                {authError && <p className="text-red-500 text-xs font-bold text-center">{authError}</p>}

                <button type="submit" className="btn-primary w-full py-5 text-lg">
                  {authMode === 'login' ? 'Đăng nhập ngay ✨' : 'Đăng ký tài khoản ✨'}
                </button>
                <div className="text-center">
                  <p className="text-gray-400 font-bold">
                    {authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'} 
                    <span 
                      className="text-primary-dark cursor-pointer ml-2 underline underline-offset-4"
                      onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                    >
                      {authMode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập ngay'}
                    </span>
                  </p>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* My Orders Modal */}
      <AnimatePresence>
        {showMyOrders && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowMyOrders(false)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 bg-primary-dark text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-primary-dark shadow-lg">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black uppercase tracking-widest">Đơn hàng của tôi 🐾</h3>
                    <p className="text-xs font-bold text-primary-light">Theo dõi và quản lý đơn hàng của bạn</p>
                  </div>
                </div>
                <button onClick={() => setShowMyOrders(false)} className="p-3 hover:bg-white/10 rounded-full transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-grow overflow-y-auto bg-gray-50 flex flex-col">
                <div className="bg-white border-b sticky top-0 z-10">
                  <div className="flex overflow-x-auto custom-scrollbar">
                    {["Tất cả", "Chờ xác nhận", "Chờ lấy hàng", "Chờ giao hàng", "Đã giao", "Trả hàng", "Đã hủy"].map(tab => (
                      <button
                        key={tab}
                        onClick={() => setMyOrdersTab(tab)}
                        className={`px-6 py-4 text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all border-b-4 ${myOrdersTab === tab ? 'border-primary-dark text-primary-dark' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-8 flex-grow overflow-y-auto custom-scrollbar">
                  {!user ? (
                    <div className="text-center py-20">
                      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <User className="w-10 h-10 text-gray-300" />
                      </div>
                      <p className="text-gray-500 font-bold mb-6">Vui lòng đăng nhập để xem đơn hàng của bạn</p>
                      <div className="flex justify-center">
                        <button onClick={() => { setShowMyOrders(false); setShowLogin(true); }} className="btn-primary px-8 py-3">Đăng nhập ngay</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {orders.filter(o => o.userId === user.uid && (myOrdersTab === "Tất cả" || o.status === myOrdersTab)).length === 0 ? (
                        <div className="text-center py-20">
                          <p className="text-gray-400 font-bold">Không tìm thấy đơn hàng nào ở mục này~</p>
                        </div>
                      ) : (
                        orders
                          .filter(o => o.userId === user.uid && (myOrdersTab === "Tất cả" || o.status === myOrdersTab))
                          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                          .map(order => (
                          <div key={order.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                            <div className="flex justify-between items-start mb-6">
                              <div>
                                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Mã đơn: #{order.id}</p>
                                <p className="text-xs text-gray-400 font-bold">{new Date(order.createdAt).toLocaleString('vi-VN')}</p>
                              </div>
                              <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                order.status === 'Đã giao' ? 'bg-green-100 text-green-600' :
                                order.status === 'Đã hủy' ? 'bg-red-100 text-red-600' :
                                'bg-primary-light/20 text-primary-dark'
                              }`}>
                                {order.status}
                              </span>
                            </div>

                            <div className="space-y-4 mb-6">
                              {(order.items || []).map((item: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-4">
                                  <img src={item.product?.image || "https://picsum.photos/seed/placeholder/100/100"} className="w-12 h-12 rounded-xl object-cover border border-gray-100" />
                                  <div className="flex-grow">
                                    <p className="text-sm font-bold text-gray-800 line-clamp-1">{item.product?.name || "Sản phẩm không xác định"}</p>
                                    {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                                      <p className="text-[10px] text-primary-dark font-bold italic mb-1">
                                        Phân loại: {Object.values(item.selectedOptions).join(', ')}
                                      </p>
                                    )}
                                    <p className="text-xs text-gray-400 font-bold">{(item.product?.price || 0).toLocaleString('vi-VN')}đ x {item.quantity}</p>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex justify-between items-center pt-6 border-t">
                              <div className="text-sm font-black text-primary-dark">
                                Tổng cộng: {order.total.toLocaleString('vi-VN')}đ
                              </div>
                              <div className="flex gap-3">
                                {order.status === 'Chờ xác nhận' && (
                                  <button 
                                    onClick={() => {
                                      setCancellingOrder(order);
                                      setShowCancelModal({ orderId: order.id, type: 'customer' });
                                      setCancelStep('confirm');
                                    }}
                                    className="px-4 py-2 text-xs font-black text-red-500 hover:bg-red-50 transition-all rounded-xl border border-red-100"
                                  >
                                    Hủy đơn
                                  </button>
                                )}
                                <button 
                                  onClick={() => setOrderDetail(order)}
                                  className="px-4 py-2 text-xs font-black text-primary-dark hover:bg-primary-light/20 transition-all rounded-xl"
                                >
                                  Chi tiết
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Shared Modals */}

      {/* Out of Stock Modal */}
      <AnimatePresence>
        {showOutOfStockModal && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowOutOfStockModal(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-2xl rounded-[3rem] p-10 shadow-2xl overflow-hidden"
            >
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <X className="w-10 h-10" />
                </div>
                <h3 className="text-3xl font-black text-gray-900 mb-2">Sản phẩm hết hàng!</h3>
                <p className="text-gray-500 font-bold">Có {affectedOrders.length} đơn hàng đang chờ xác nhận chứa sản phẩm này.</p>
              </div>

              <div className="max-h-[40vh] overflow-y-auto mb-8 space-y-4 custom-scrollbar">
                {affectedOrders.map(order => (
                  <div key={order.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-black text-gray-800">#{order.id} - {order.customer.name}</p>
                      <p className="text-xs text-gray-400 font-bold">{order.customer.phone}</p>
                    </div>
                    <button 
                      onClick={() => {
                        handleUpdateOrderStatus(order.id, { status: 'Đã hủy', adminCancelReason: 'Sản phẩm hết hàng' });
                        setAffectedOrders(prev => prev.filter(o => o.id !== order.id));
                      }}
                      className="px-4 py-2 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 transition-all"
                    >
                      Hủy đơn này
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-4">
                <button onClick={() => setShowOutOfStockModal(null)} className="flex-1 p-5 rounded-2xl bg-gray-100 text-gray-500 font-bold">Đóng</button>
                <button 
                  onClick={() => {
                    affectedOrders.forEach(order => {
                      handleUpdateOrderStatus(order.id, { status: 'Đã hủy', adminCancelReason: 'Sản phẩm hết hàng' });
                    });
                    setShowOutOfStockModal(null);
                  }}
                  className="flex-1 btn-primary bg-red-500 hover:bg-red-600"
                >
                  Hủy tất cả {affectedOrders.length} đơn
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {quickViewProduct && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setQuickViewProduct(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-4xl rounded-[3rem] overflow-hidden shadow-2xl flex flex-col md:flex-row"
            >
              <button onClick={() => setQuickViewProduct(null)} className="absolute top-6 right-6 z-20 p-2 bg-gray-100 rounded-full hover:bg-primary hover:text-white transition-all">
                <X className="w-6 h-6" />
              </button>
              <div className="md:w-1/2 bg-gray-50 flex flex-col">
                <div className="flex-grow relative overflow-hidden bg-white flex items-center justify-center min-h-[300px]">
                  <AnimatePresence mode="wait">
                    <motion.img 
                      key={selectedQuickViewImage || quickViewProduct.image}
                      initial={{ opacity: 0, scale: 1.1 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                      src={cleanImageUrl(selectedQuickViewImage || quickViewProduct.image)} 
                      alt={quickViewProduct.name} 
                      className="max-w-full max-h-full object-contain absolute" 
                      referrerPolicy="no-referrer"
                    />
                  </AnimatePresence>
                </div>
                {quickViewProduct.images && quickViewProduct.images.length > 0 && (
                  <div className="flex gap-2 p-4 bg-gray-50/50 backdrop-blur-sm overflow-x-auto custom-scrollbar border-t border-gray-100">
                     {[quickViewProduct.image, ...quickViewProduct.images.filter(img => img !== quickViewProduct.image)].map((img, idx) => (
                       <button 
                         key={idx}
                         onClick={() => setSelectedQuickViewImage(img)}
                         className={`w-16 h-16 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${selectedQuickViewImage === img ? 'border-primary-dark shadow-md scale-105' : 'border-transparent hover:border-primary-light'}`}
                       >
                         <img src={cleanImageUrl(img)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                       </button>
                     ))}
                  </div>
                )}
              </div>
              <div className="md:w-1/2 p-6 md:p-8 flex flex-col max-h-[90vh] overflow-y-auto custom-scrollbar">
                  <h3 className="text-xl md:text-2xl text-gray-900 mb-2 font-sans font-black tracking-tight">{quickViewProduct.name}</h3>
                
                <div className="flex items-baseline gap-3 mb-4">
                  <div className="text-3xl md:text-4xl font-black text-primary-dark">
                    {(quickViewProduct.price * quickViewQuantity * (quickViewProduct.purchaseMode === 'combo' && quickViewOptions['Combo'] ? parseInt(quickViewOptions['Combo']) / Math.min(...(quickViewProduct.combos || [1])) : 1)).toLocaleString('vi-VN')}đ
                  </div>
                  {quickViewProduct.originalPrice && (
                    <div className="text-base md:text-lg font-bold text-gray-300 line-through">
                      {(quickViewProduct.originalPrice * quickViewQuantity * (quickViewProduct.purchaseMode === 'combo' && quickViewOptions['Combo'] ? parseInt(quickViewOptions['Combo']) / Math.min(...(quickViewProduct.combos || [1])) : 1)).toLocaleString('vi-VN')}đ
                    </div>
                  )}
                </div>

                {quickViewProduct.options && quickViewProduct.options.length > 0 && (
                  <div className="mb-4 space-y-3">
                    {quickViewProduct.options.map(opt => (
                      <div key={opt.name} className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{opt.name}</label>
                        <div className="flex flex-wrap gap-2">
                          {opt.values.map(val => (
                            <button 
                              key={val}
                              onClick={() => {
                                setQuickViewOptions(prev => ({...prev, [opt.name]: val}));
                                if (opt.images?.[val]) {
                                  setSelectedQuickViewImage(opt.images[val]);
                                }
                              }}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border-2 ${quickViewOptions[opt.name] === val ? 'bg-primary-dark text-white border-primary-dark' : 'bg-white text-gray-500 border-gray-100 hover:border-primary-light'}`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-4 mb-4 bg-gray-50/50 p-6 rounded-[2rem] border border-gray-100 shadow-inner">
                    {/* Combo Selection */}
                    {quickViewProduct.purchaseMode === 'combo' && quickViewProduct.combos?.length && (
                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                           <Sparkles className="w-3 h-3 text-primary-dark" /> Chọn gói Combo ✨
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {quickViewProduct.combos.sort((a,b) => a-b).map(c => (
                            <button 
                              key={c}
                              onClick={() => setQuickViewOptions(prev => ({...prev, 'Combo': c.toString()}))}
                               className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all border-2 ${quickViewOptions['Combo'] === c.toString() ? 'bg-primary-dark text-white border-primary-dark shadow-md scale-105' : 'bg-white text-gray-500 border-gray-100 hover:border-primary-light'}`}
                            >
                              Combo {c}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quantity Selector */}
                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <User className="w-3 h-3 text-primary-dark" /> Số lượng đặt mua
                      </label>
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center bg-white rounded-2xl p-1 border-2 border-primary-light/30 shadow-sm">
                          <button 
                            onClick={() => setQuickViewQuantity(q => Math.max(quickViewProduct.minQuantity || 1, q - 1))}
                            className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-primary-dark transition-colors"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input 
                            type="number"
                            value={quickViewQuantity}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              if (!isNaN(val)) setQuickViewQuantity(Math.max(quickViewProduct.minQuantity || 1, val));
                            }}
                            className="w-12 text-center bg-transparent font-black text-lg focus:outline-none"
                          />
                          <button 
                            onClick={() => setQuickViewQuantity(q => q + 1)}
                            className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-primary-dark transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        {quickViewProduct.minQuantity && quickViewProduct.minQuantity > 1 && (
                          <span className="text-[10px] text-primary-dark font-black px-3 py-1 bg-primary-light/20 rounded-full italic">
                            * Ít nhất {quickViewProduct.minQuantity} cái
                          </span>
                        )}
                      </div>
                    </div>
                </div>
                <div className="mt-auto flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={() => { 
                      if (quickViewProduct.options?.some(opt => !quickViewOptions[opt.name])) {
                        showAlert("Vui lòng chọn đầy đủ các phân loại nhé! 🌸", "info");
                        return;
                      }
                      if (quickViewProduct.purchaseMode === 'combo' && !quickViewOptions['Combo']) {
                        showAlert("Vui lòng chọn gói Combo nhé! 🌸", "info");
                        return;
                      }
                      addToCart(quickViewProduct, quickViewOptions, quickViewQuantity); 
                      setQuickViewProduct(null); 
                    }}
                    className="flex-grow btn-primary flex items-center justify-center gap-3 border-2 border-primary-dark bg-white text-primary-dark hover:bg-primary-light/10"
                  >
                    <ShoppingCart className="w-5 h-5" /> Thêm vào giỏ
                  </button>
                  <button 
                    onClick={() => { 
                      if (quickViewProduct.options?.some(opt => !quickViewOptions[opt.name])) {
                        showAlert("Vui lòng chọn đầy đủ các phân loại nhé! 🌸", "info");
                        return;
                      }
                      if (quickViewProduct.purchaseMode === 'combo' && !quickViewOptions['Combo']) {
                        showAlert("Vui lòng chọn gói Combo nhé! 🌸", "info");
                        return;
                      }
                      handleBuyNow(quickViewProduct, quickViewOptions, quickViewQuantity);
                      setQuickViewProduct(null);
                    }}
                    className="flex-grow btn-primary flex items-center justify-center gap-3"
                  >
                    Mua luôn ✨
                  </button>
                  <button 
                    onClick={() => toggleFavorite(quickViewProduct.id)}
                    className={`p-4 rounded-2xl transition-all hidden sm:block border-2 ${favorites.includes(quickViewProduct.id) ? 'bg-red-50 border-red-200 text-red-500' : 'bg-primary-light/30 border-transparent text-primary-dark hover:bg-primary-light'}`}
                  >
                    <HeartIcon className={`w-6 h-6 ${favorites.includes(quickViewProduct.id) ? 'fill-current' : ''}`} />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {showCheckout && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCheckout(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="p-10 pb-4 flex justify-between items-center border-b border-gray-50">
                <h3 className="text-3xl font-black text-gray-900">Thông tin đặt hàng 🐾</h3>
            <button onClick={() => { setShowCheckout(false); setOrderStatus('idle'); setDirectBuyItem(null); }} className="p-2 bg-gray-100 rounded-full hover:bg-primary hover:text-white transition-all">
              <X className="w-6 h-6" />
            </button>
              </div>

              <div className="flex-grow overflow-y-auto p-10 pt-6 custom-scrollbar">
                {orderStatus === 'success' ? (
                  <div className="text-center py-10">
                    <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
                      <Sparkles className="w-12 h-12" />
                    </div>
                    <h3 className="text-3xl font-black text-gray-900 mb-4">Đặt hàng thành công!</h3>
                    <p className="text-gray-500 font-medium mb-8">Cảm ơn bạn đã ủng hộ HanaChiBi. Báo Hồng sẽ sớm liên hệ với bạn để xác nhận đơn hàng nhé! 🐾</p>
                    <div className="flex flex-col items-center justify-center">
                      <button onClick={() => { setShowCheckout(false); setOrderStatus('idle'); }} className="btn-primary px-12 h-14 flex items-center justify-center">Tiếp tục mua sắm</button>
                    </div>
                  </div>
                ) : showQR ? (
                  <div className="text-center space-y-8">
                    <div className="bg-primary-light/10 p-8 rounded-[2.5rem] border-2 border-primary-light/30">
                      <h4 className="text-xl font-black text-primary-dark mb-4">Quét mã QR để thanh toán</h4>
                      <div className="bg-white p-6 rounded-3xl shadow-xl inline-block mb-6">
                        <img 
                          src={settings.qrCode || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=STK:0123456789|NH:MBBANK|CT:THANH TOAN DON HANG ${customerInfo.phone}`} 
                          alt="QR Code" 
                          className="w-64 h-64 mx-auto object-contain"
                        />
                      </div>
                      <div className="space-y-2 text-left bg-white p-6 rounded-2xl border border-primary-light/20">
                        <p className="text-sm font-bold text-gray-700 flex justify-between"><span>Ngân hàng:</span> <span className="text-primary-dark">MB Bank</span></p>
                        <p className="text-sm font-bold text-gray-700 flex justify-between"><span>Số tài khoản:</span> <span className="text-primary-dark">0396265421</span></p>
                        <p className="text-sm font-bold text-gray-700 flex justify-between"><span>Chủ TK:</span> <span className="text-primary-dark uppercase">HanaChiBi Shop</span></p>
                        <p className="text-sm font-bold text-gray-700 flex justify-between"><span>Số tiền:</span> <span className="text-red-500">{(
                          cartTotal 
                          - (vouchers.find(v => v.code === customerInfo.voucher && cartTotal >= v.minOrder)?.discount || 0) 
                          + (customerInfo.shippingMethod === 'express' ? 35000 : 20000)
                          - (customerInfo.useCoins ? Math.min(user?.coins || 0, cartTotal - (vouchers.find(v => v.code === customerInfo.voucher && cartTotal >= v.minOrder)?.discount || 0) + (customerInfo.shippingMethod === 'express' ? 35000 : 20000)) : 0)
                        ).toLocaleString('vi-VN')}đ</span></p>
                        <p className="text-sm font-bold text-gray-700 flex justify-between"><span>Nội dung:</span> <span className="text-primary-dark">{customerInfo.phone}</span></p>
                      </div>
                    </div>
                      <div className="flex gap-4">
                        <button onClick={() => setShowQR(false)} className="flex-1 p-5 rounded-2xl bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 transition-all">Quay lại</button>
                        <button 
                          onClick={handleCheckout} 
                          disabled={orderStatus === 'submitting'}
                          className="flex-1 btn-primary"
                        >
                          {orderStatus === 'submitting' ? (
                            <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            'Tôi đã chuyển khoản'
                          )}
                        </button>
                      </div>
                  </div>
                ) : (
                  <form onSubmit={handleCheckout} className="space-y-8">
                    {/* Item Summary in Checkout */}
                    <div className="mb-4 p-6 bg-gray-50 rounded-3xl border border-gray-100">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <ShoppingBag className="w-3 h-3 text-primary-dark" /> Chi tiết đơn hàng ({itemsToCheckout.length})
                      </h4>
                      <div className="space-y-4 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                        {itemsToCheckout.map((item, idx) => (
                           <div key={idx} className="flex gap-3 items-center">
                             <img src={cleanImageUrl(item.product.image)} className="w-12 h-12 rounded-xl object-cover shrink-0" referrerPolicy="no-referrer" />
                             <div className="flex-grow">
                               <p className="text-xs font-black text-gray-800 line-clamp-1">{item.product.name}</p>
                               {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                                  <p className="text-[9px] text-primary-dark font-bold italic">
                                    Phân loại: {Object.values(item.selectedOptions).join(', ')}
                                  </p>
                               )}
                               <div className="flex gap-2">
                                 <p className="text-[10px] font-bold text-gray-400 italic">
                                   SL: {item.quantity} x {item.product.price.toLocaleString('vi-VN')}đ
                                 </p>
                               </div>
                             </div>
                             <p className="text-xs font-black text-primary-dark shrink-0">{(item.product.price * item.quantity).toLocaleString('vi-VN')}đ</p>
                           </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Họ và tên</label>
                        <input 
                          required
                          value={customerInfo.name}
                          onChange={e => setCustomerInfo({...customerInfo, name: e.target.value})}
                          className="w-full px-8 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold"
                          placeholder="Nguyễn Văn A"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Số điện thoại</label>
                        <input 
                          required
                          value={customerInfo.phone}
                          onChange={e => setCustomerInfo({...customerInfo, phone: e.target.value})}
                          className="w-full px-8 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold"
                          placeholder="09xx xxx xxx"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Tỉnh / Thành phố {loadingLocations.p && "..."}</label>
                        <div className="relative group">
                          <select 
                            required
                            value={customerInfo.province}
                            onChange={e => setCustomerInfo({...customerInfo, province: e.target.value, district: "", ward: ""})}
                            className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold appearance-none text-sm pr-10"
                          >
                            <option value="">Chọn Tỉnh/TP</option>
                            {provinces.map(p => <option key={p.code} value={p.name}>{p.name}</option>)}
                          </select>
                          <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 rotate-90 pointer-events-none group-focus-within:text-primary-dark transition-colors" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Quận / Huyện {loadingLocations.d && "..."}</label>
                        <div className="relative group">
                          <select 
                            required
                            disabled={!customerInfo.province || loadingLocations.d}
                            value={customerInfo.district}
                            onChange={e => setCustomerInfo({...customerInfo, district: e.target.value, ward: ""})}
                            className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold appearance-none text-sm pr-10 disabled:opacity-50"
                          >
                            <option value="">Chọn Quận/Huyện</option>
                            {districts.map(d => <option key={d.code} value={d.name}>{d.name}</option>)}
                          </select>
                          <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 rotate-90 pointer-events-none group-focus-within:text-primary-dark transition-colors" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4">Phường / Xã {loadingLocations.w && "..."}</label>
                        <div className="relative group">
                          <select 
                            required
                            disabled={!customerInfo.district || loadingLocations.w}
                            value={customerInfo.ward}
                            onChange={e => setCustomerInfo({...customerInfo, ward: e.target.value})}
                            className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold appearance-none text-sm pr-10 disabled:opacity-50"
                          >
                            <option value="">Chọn Phường/Xã</option>
                            {wards.map(w => <option key={w.code} value={w.name}>{w.name}</option>)}
                          </select>
                          <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 rotate-90 pointer-events-none group-focus-within:text-primary-dark transition-colors" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Địa chỉ chi tiết (Số nhà, tên đường...)</label>
                      <input 
                        required
                        value={customerInfo.address}
                        onChange={e => setCustomerInfo({...customerInfo, address: e.target.value})}
                        className="w-full px-8 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold"
                        placeholder="Số nhà, tên đường, thôn/xóm..."
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Mã giảm giá</label>
                        <div className="flex gap-2">
                          <input 
                            value={customerInfo.voucher}
                            onChange={e => setCustomerInfo({...customerInfo, voucher: e.target.value.toUpperCase()})}
                            className="flex-grow px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold"
                            placeholder="NHẬP MÃ..."
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Phương thức vận chuyển</label>
                        <select 
                          value={customerInfo.shippingMethod}
                          onChange={e => setCustomerInfo({...customerInfo, shippingMethod: e.target.value})}
                          className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold appearance-none"
                        >
                          <option value="standard">Giao hàng tiêu chuẩn (20k)</option>
                          <option value="express">Giao hàng hỏa tốc (35k)</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Phương thức thanh toán</label>
                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          type="button"
                          onClick={() => setCustomerInfo({...customerInfo, paymentMethod: 'cod'})}
                          className={`px-6 py-4 rounded-2xl border-2 font-bold transition-all ${customerInfo.paymentMethod === 'cod' ? 'border-primary-dark bg-primary-light/10 text-primary-dark' : 'border-gray-100 bg-gray-50 text-gray-400'}`}
                        >
                          Thanh toán khi nhận hàng (COD)
                        </button>
                        <button 
                          type="button"
                          onClick={() => setCustomerInfo({...customerInfo, paymentMethod: 'bank'})}
                          className={`px-6 py-4 rounded-2xl border-2 font-bold transition-all ${customerInfo.paymentMethod === 'bank' ? 'border-primary-dark bg-primary-light/10 text-primary-dark' : 'border-gray-100 bg-gray-50 text-gray-400'}`}
                        >
                          Chuyển khoản ngân hàng
                        </button>
                      </div>
                      {customerInfo.paymentMethod === 'bank' && (
                        <div className="mt-4 p-6 bg-primary-light/10 rounded-2xl border-2 border-primary-light/30">
                          <p className="text-xs font-black text-primary-dark uppercase mb-2">Thông tin chuyển khoản:</p>
                          <p className="text-sm font-bold text-gray-700">Ngân hàng: MB Bank</p>
                          <p className="text-sm font-bold text-gray-700">STK: 0396265421</p>
                          <p className="text-sm font-bold text-gray-700">Chủ TK: HanaChiBi Shop</p>
                          <p className="text-xs text-gray-400 mt-2 italic">* Vui lòng ghi nội dung chuyển khoản là SĐT của bạn.</p>
                        </div>
                      )}
                    </div>

                    {user && user.coins > 0 && (
                      <div className="flex items-center justify-between p-6 bg-pastel-yellow/10 rounded-2xl border-2 border-pastel-yellow/30">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-pastel-yellow rounded-full flex items-center justify-center text-white font-black shadow-sm">
                            Xu
                          </div>
                          <div>
                            <p className="text-sm font-black text-gray-900">Dùng xu tích điểm</p>
                            <p className="text-xs font-bold text-gray-400">Bạn đang có {user.coins} xu</p>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={customerInfo.useCoins}
                            onChange={e => setCustomerInfo({...customerInfo, useCoins: e.target.checked})}
                            className="sr-only peer" 
                          />
                          <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">Ghi chú (nếu có)</label>
                      <textarea 
                        value={customerInfo.note}
                        onChange={e => setCustomerInfo({...customerInfo, note: e.target.value})}
                        className="w-full px-8 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light focus:bg-white outline-none transition-all font-bold h-24 resize-none"
                        placeholder="Lời nhắn cho shop..."
                      />
                    </div>
                    
                    <div className="p-8 bg-gray-900 rounded-[2.5rem] text-white">
                      <div className="space-y-4 mb-8">
                        <div className="flex justify-between text-sm font-bold text-gray-400">
                          <span>Tạm tính ({itemsToCheckout.length} sản phẩm):</span>
                          <span>{cartTotal.toLocaleString('vi-VN')}đ</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-gray-400">
                          <span>Phí vận chuyển:</span>
                          <span>{(customerInfo.shippingMethod === 'express' ? 35000 : 20000).toLocaleString('vi-VN')}đ</span>
                        </div>
                        {customerInfo.voucher && vouchers.find(v => v.code === customerInfo.voucher && cartTotal >= v.minOrder) && (
                          <div className="flex justify-between text-sm font-bold text-green-400">
                            <span>Giảm giá voucher:</span>
                            <span>-{vouchers.find(v => v.code === customerInfo.voucher)?.discount.toLocaleString('vi-VN')}đ</span>
                          </div>
                        )}
                        {customerInfo.useCoins && (
                          <div className="flex justify-between text-sm font-bold text-pastel-yellow">
                            <span>Dùng xu:</span>
                            <span>-{Math.min(user?.coins || 0, cartTotal).toLocaleString('vi-VN')}đ</span>
                          </div>
                        )}
                        <div className="pt-4 border-t border-gray-800 flex justify-between items-center">
                          <span className="text-lg font-black">Tổng thanh toán:</span>
                          <span className="text-3xl font-black text-primary-light">
                            {(
                              cartTotal 
                              - (vouchers.find(v => v.code === customerInfo.voucher && cartTotal >= v.minOrder)?.discount || 0)
                              + (customerInfo.shippingMethod === 'express' ? 35000 : 20000)
                              - (customerInfo.useCoins ? Math.min(user?.coins || 0, cartTotal - (vouchers.find(v => v.code === customerInfo.voucher && cartTotal >= v.minOrder)?.discount || 0) + (customerInfo.shippingMethod === 'express' ? 35000 : 20000)) : 0)
                            ).toLocaleString('vi-VN')}đ
                          </span>
                        </div>
                      </div>
                      <button 
                        type="submit"
                        disabled={orderStatus === 'submitting'}
                        className="w-full bg-primary-dark text-white py-6 rounded-3xl font-black text-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 shadow-2xl shadow-primary-dark/30 group mb-4"
                      >
                        {orderStatus === 'submitting' ? (
                          <>
                            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
                            <span>ĐANG XỬ LÝ...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-7 h-7 group-hover:rotate-12 transition-transform" />
                            <span>{customerInfo.paymentMethod === 'bank' ? 'TIẾP TỤC THANH TOÁN' : 'XÁC NHẬN ĐẶT HÀNG'}</span>
                          </>
                        )}
                      </button>
                      <p className="text-center text-[10px] font-black text-gray-500 uppercase tracking-widest mt-4">
                        Bạn sẽ nhận được {Math.floor(cartTotal / 10000)} xu sau khi đơn hàng hoàn tất 🐾
                      </p>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Zalo Button */}
      <button 
        onClick={openZalo}
        className="fixed bottom-8 right-8 z-[80] w-16 h-16 bg-[#0068ff] rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-all group"
      >
        <img src="https://upload.wikimedia.org/wikipedia/commons/9/91/Icon_of_Zalo.svg" className="w-10 h-10 bg-white rounded-full p-1" />
        <div className="absolute right-20 bg-white px-4 py-2 rounded-xl shadow-xl text-xs font-black text-[#0068ff] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border-2 border-[#0068ff]/10">
          Chat với shop ngay! 🐾
        </div>
      </button>

      {/* Floating Mascot */}
      <div className="fixed bottom-8 left-8 z-[80] hidden md:block">
        <motion.div 
          animate={{ y: [0, -10, 0] }} 
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="relative group"
        >
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-white px-4 py-2 rounded-2xl shadow-xl text-xs font-black text-primary-dark opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap border-2 border-primary-light">
            Chào bạn! Pink Panther đang đợi bạn đây~ 🐾
          </div>
          <div className="w-20 h-20 bg-white rounded-full border-4 border-primary-light shadow-2xl flex items-center justify-center overflow-hidden">
            <img 
              src={cleanImageUrl(settings.mascotImage)} 
              alt="Hana" 
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi-mascot/200/200";
              }}
            />
          </div>
        </motion.div>
      </div>

      {/* Cart Drawer */}
      <AnimatePresence>
        {showCart && (
          <div className="fixed inset-0 z-[100]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCart(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div 
              initial={{ x: "100%" }} 
              animate={{ x: 0 }} 
              exit={{ x: "100%" }}
              className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col"
            >
              <div className="p-8 border-b flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <input 
                    type="checkbox"
                    checked={cart.length > 0 && selectedCartItems.length === cart.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedCartItems(cart.map(item => getCartItemId(item)));
                      } else {
                        setSelectedCartItems([]);
                      }
                    }}
                    className="w-5 h-5 rounded accent-primary-dark cursor-pointer"
                  />
                  <h3 className="text-2xl font-black text-gray-900">Giỏ hàng ({cartCount})</h3>
                </div>
                <button onClick={() => setShowCart(false)} className="p-2 hover:bg-gray-100 rounded-full transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-grow overflow-y-auto p-8">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <div className="w-24 h-24 bg-primary-light/20 rounded-full flex items-center justify-center mb-6">
                      <ShoppingBag className="w-10 h-10 text-primary-dark" />
                    </div>
                    <p className="text-gray-400 font-bold">Giỏ hàng đang trống trơn~</p>
                    <div className="flex justify-center w-full">
                      <button 
                        onClick={() => setShowCart(false)} 
                        className="mt-6 px-10 py-3 rounded-full bg-primary-light/30 text-primary-dark font-black hover:bg-primary-light transition-all flex items-center gap-2"
                      >
                        Tiếp tục mua sắm 🛍️
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {cart.map(item => {
                      const cartId = getCartItemId(item);
                      return (
                        <div key={cartId} className="flex gap-4 items-center bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
                          <input 
                            type="checkbox"
                            checked={selectedCartItems.includes(cartId)}
                            onChange={() => {
                              if (selectedCartItems.includes(cartId)) {
                                setSelectedCartItems(selectedCartItems.filter(id => id !== cartId));
                              } else {
                                setSelectedCartItems([...selectedCartItems, cartId]);
                              }
                            }}
                            className="w-5 h-5 rounded accent-primary-dark cursor-pointer shrink-0"
                          />
                          <img src={cleanImageUrl(item.product.image)} className="w-20 h-20 rounded-2xl object-cover border-2 border-primary-light/20" />
                          <div className="flex-grow">
                            <h4 className="product-name-elegant text-gray-800 text-sm line-clamp-1">{item.product.name}</h4>
                            {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(item.selectedOptions).map(([name, value]) => (
                                  <span key={name} className="text-[10px] px-2 py-0.5 bg-primary-light/30 text-primary-dark rounded-full font-bold">
                                    {name}: {value}
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="text-primary-dark font-black text-sm mt-1">{(item.product.price * item.quantity).toLocaleString('vi-VN')}đ</p>
                            <div className="flex items-center gap-3 mt-2">
                              <button 
                                onClick={() => {
                                  if (item.quantity > 1) {
                                    setCart(prev => prev.map(c => getCartItemId(c) === cartId ? { ...c, quantity: c.quantity - 1 } : c));
                                  }
                                }}
                                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-primary-light transition-colors"
                              >
                                -
                              </button>
                              <span className="font-black text-sm w-4 text-center">{item.quantity}</span>
                              <button 
                                onClick={() => setCart(prev => prev.map(c => getCartItemId(c) === cartId ? { ...c, quantity: c.quantity + 1 } : c))}
                                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-primary-light transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <button 
                            onClick={() => setCart(prev => prev.filter(c => getCartItemId(c) !== cartId))}
                            className="text-gray-300 hover:text-red-400 transition-colors p-2"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {cart.length > 0 && (
                  <div className="p-8 bg-gray-50 border-t">
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-gray-500 font-bold">Tổng cộng:</span>
                      <span className="text-2xl font-black text-primary-dark">{cartTotal.toLocaleString('vi-VN')}đ</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button 
                        disabled={selectedCartItems.length === 0}
                        onClick={() => { 
                          if (!user) {
                            showAlert("Opps! Bạn cần đăng nhập để có thể đặt hàng nhé 🌸", "info");
                            setShowLogin(true);
                            return;
                          }
                          setShowCart(false); 
                          setShowCheckout(true); 
                        }}
                        className="w-full btn-primary py-5 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Thanh toán ngay ({selectedCartItems.length}) ✨
                      </button>
                      <button 
                        onClick={openZalo}
                        className="w-full py-5 rounded-full bg-[#0068ff] text-white font-black flex items-center justify-center gap-3 hover:bg-[#0052cc] transition-all shadow-lg"
                      >
                        <img src="https://upload.wikimedia.org/wikipedia/commons/9/91/Icon_of_Zalo.svg" className="w-6 h-6 bg-white rounded-full p-0.5" />
                        Chốt đơn qua Zalo
                      </button>
                    </div>
                  </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        </>
      )}

      {/* Order Detail Modal */}
      <AnimatePresence>
        {orderDetail && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOrderDetail(null)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 bg-primary-dark text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-primary-dark shadow-lg">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black uppercase tracking-widest">Chi tiết đơn hàng 🐾</h3>
                    <p className="text-xs font-bold text-primary-light">Mã đơn: #{orderDetail.id}</p>
                  </div>
                </div>
                <button onClick={() => setOrderDetail(null)} className="p-3 hover:bg-white/10 rounded-full transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 overflow-y-auto custom-scrollbar space-y-8">
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Thông tin người mua</h4>
                    <div className="space-y-2">
                      <p className="font-black text-gray-900">{orderDetail.customer.name}</p>
                      <p className="text-sm text-gray-500 font-bold flex items-center gap-2"><Phone className="w-4 h-4" /> {orderDetail.customer.phone}</p>
                      <p className="text-sm text-gray-500 font-medium flex items-center gap-2"><MapPin className="w-4 h-4" /> {orderDetail.customer.fullAddress || orderDetail.customer.address}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Trạng thái & Thanh toán</h4>
                    <div className="space-y-2">
                      <p className="text-sm font-bold text-gray-900">Phương thức: <span className="text-primary-dark uppercase">{orderDetail.customer.paymentMethod === 'bank' ? 'Chuyển khoản' : 'COD'}</span></p>
                      <p className="text-sm font-bold text-gray-900">Vận chuyển: <span className="text-primary-dark uppercase">{orderDetail.customer.shippingMethod === 'express' ? 'Hỏa tốc' : 'Tiêu chuẩn'}</span></p>
                      <span className={`inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        orderDetail.status === 'Đã giao' ? 'bg-green-100 text-green-600' :
                        orderDetail.status === 'Đã hủy' ? 'bg-red-100 text-red-600' :
                        'bg-primary-light/20 text-primary-dark'
                      }`}>
                        {orderDetail.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Sản phẩm đã mua</h4>
                  <div className="space-y-3">
                        {(orderDetail.items || []).map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                            <img src={cleanImageUrl(item.product?.image || "https://picsum.photos/seed/placeholder/100/100")} className="w-14 h-14 rounded-xl object-cover border border-gray-200" />
                            <div className="flex-grow">
                              <p className="font-bold text-gray-800">{item.product?.name || "Sản phẩm không xác định"}</p>
                              {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                                <p className="text-[10px] text-primary-dark font-bold italic mb-1">
                                  Phân loại: {Object.values(item.selectedOptions).join(', ')}
                                </p>
                              )}
                              <p className="text-xs text-gray-400 font-bold">{(item.product?.price || 0).toLocaleString('vi-VN')}đ x {item.quantity}</p>
                            </div>
                            <p className="font-black text-primary-dark">{((item.product?.price || 0) * item.quantity).toLocaleString('vi-VN')}đ</p>
                          </div>
                        ))}
                  </div>
                </div>

                {orderDetail.status === 'Đã hủy' && (
                  <div className="p-6 bg-red-50 rounded-3xl border-2 border-red-100">
                    <p className="text-xs font-black text-red-400 uppercase tracking-widest mb-2">Thông tin hủy đơn</p>
                    <p className="text-sm font-bold text-red-600">Người hủy: {orderDetail.cancelledBy}</p>
                    <p className="text-sm font-bold text-red-600">Lý do: {orderDetail.cancelReason}</p>
                    {orderDetail.outOfStockItems && orderDetail.outOfStockItems.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold text-red-400">Sản phẩm hết hàng:</p>
                        <ul className="list-disc list-inside text-xs text-red-600 font-bold mt-1">
                          {orderDetail.items.filter((item: any) => orderDetail.outOfStockItems.includes(item.product.id)).map((item: any) => (
                            <li key={item.product.id}>{item.product.name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-6 border-t space-y-2">
                  <div className="flex justify-between text-sm font-bold text-gray-400">
                    <span>Tạm tính:</span>
                    <span>{(orderDetail.total + orderDetail.discount - orderDetail.shipping + orderDetail.coinsUsed).toLocaleString('vi-VN')}đ</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-gray-400">
                    <span>Phí vận chuyển:</span>
                    <span>{orderDetail.shipping.toLocaleString('vi-VN')}đ</span>
                  </div>
                  {orderDetail.discount > 0 && (
                    <div className="flex justify-between text-sm font-bold text-green-500">
                      <span>Giảm giá:</span>
                      <span>-{orderDetail.discount.toLocaleString('vi-VN')}đ</span>
                    </div>
                  )}
                  {orderDetail.coinsUsed > 0 && (
                    <div className="flex justify-between text-sm font-bold text-pastel-yellow">
                      <span>Dùng xu:</span>
                      <span>-{orderDetail.coinsUsed.toLocaleString('vi-VN')}đ</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-4">
                    <span className="text-lg font-black text-gray-900">Tổng cộng:</span>
                    <span className="text-3xl font-black text-primary-dark">{orderDetail.total.toLocaleString('vi-VN')}đ</span>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-gray-50 border-t flex gap-4">
                {isAdminView && orderDetail.status === 'Chờ xác nhận' && (
                  <button 
                    onClick={() => handleUpdateOrderStatus(orderDetail.id, { status: 'Chờ lấy hàng' })}
                    className="flex-1 py-4 rounded-2xl bg-primary-dark text-white font-black hover:bg-primary-dark/90 transition-all shadow-lg shadow-primary-dark/20 flex items-center justify-center gap-3"
                  >
                    <Check className="w-5 h-5" /> Xác nhận đơn
                  </button>
                )}
                {isAdminView && (
                  <button 
                    onClick={() => { try { window.print(); } catch(err) { console.error(err); } }}
                    className="flex-1 py-4 rounded-2xl bg-white border-2 border-gray-200 text-gray-600 font-black flex items-center justify-center gap-3 hover:bg-gray-100 transition-all"
                  >
                    <Printer className="w-5 h-5" /> In hóa đơn
                  </button>
                )}
                {orderDetail.status !== 'Đã hủy' && (
                  <button 
                    onClick={() => {
                      setCancellingOrder(orderDetail);
                      setShowCancelModal({ orderId: orderDetail.id, type: isAdminView ? 'admin' : 'customer' });
                      setCancelStep('confirm');
                    }}
                    className="flex-1 py-4 rounded-2xl bg-red-500 text-white font-black hover:bg-red-600 transition-all shadow-lg shadow-red-200"
                  >
                    Hủy đơn hàng
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cancel Order Modal */}
      <AnimatePresence>
        {showCancelModal && cancellingOrder && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCancelModal(null)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-md rounded-[3rem] shadow-2xl p-10"
            >
              {cancelStep === 'confirm' && (
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-500">
                    <Trash2 className="w-10 h-10" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-gray-900">Hủy đơn hàng?</h3>
                    <p className="text-gray-400 font-bold mt-2">Bạn có chắc chắn muốn hủy đơn hàng #{showCancelModal.orderId} không?</p>
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button onClick={() => setShowCancelModal(null)} className="flex-1 py-4 rounded-2xl bg-gray-100 text-gray-500 font-black">Quay lại</button>
                    <button onClick={() => setCancelStep('reason')} className="flex-1 py-4 rounded-2xl bg-red-500 text-white font-black shadow-lg shadow-red-200">Đồng ý</button>
                  </div>
                </div>
              )}

              {cancelStep === 'reason' && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-black text-gray-900">Lý do hủy đơn</h3>
                  <div className="space-y-3">
                    {(showCancelModal.type === 'admin' 
                      ? ["Hết hàng", "Khách hàng yêu cầu hủy", "Thông tin không hợp lệ", "Đơn hàng trùng lặp", "Lý do khác"]
                      : ["Muốn thay đổi địa chỉ nhận hàng", "Muốn thay đổi sản phẩm", "Tìm thấy giá rẻ hơn", "Không còn nhu cầu mua nữa", "Lý do khác"]
                    ).map(reason => (
                      <button 
                        key={reason}
                        onClick={() => {
                          setCancelReason(reason);
                          if (showCancelModal.type === 'admin' && reason === 'Hết hàng') {
                            setCancelStep('products');
                          }
                        }}
                        className={`w-full text-left px-6 py-4 rounded-2xl font-bold transition-all border-2 ${cancelReason === reason ? 'border-primary-dark bg-primary-light/10 text-primary-dark' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button onClick={() => setCancelStep('confirm')} className="flex-1 py-4 rounded-2xl bg-gray-100 text-gray-500 font-black">Quay lại</button>
                    <button 
                      disabled={!cancelReason}
                      onClick={() => {
                        if (showCancelModal.type === 'admin' && cancelReason === 'Hết hàng') {
                          setCancelStep('products');
                        } else {
                          handleCancelOrder();
                        }
                      }} 
                      className="flex-1 py-4 rounded-2xl bg-primary-dark text-white font-black shadow-lg disabled:opacity-50"
                    >
                      {showCancelModal.type === 'admin' && cancelReason === 'Hết hàng' ? 'Tiếp tục' : 'Xác nhận hủy'}
                    </button>
                  </div>
                </div>
              )}

              {cancelStep === 'products' && (
                <div className="space-y-8">
                  <div>
                    <h3 className="text-2xl font-black text-gray-900">Sản phẩm hết hàng</h3>
                    <p className="text-gray-400 font-bold mt-1 text-sm">Vui lòng chọn các sản phẩm đã hết hàng</p>
                  </div>
                  <div className="space-y-3 max-h-[40vh] overflow-y-auto custom-scrollbar pr-2">
                    {cancellingOrder.items.map((item: any) => (
                      <div 
                        key={item.product.id}
                        onClick={() => {
                          if (outOfStockItems.includes(item.product.id)) {
                            setOutOfStockItems(outOfStockItems.filter(id => id !== item.product.id));
                          } else {
                            setOutOfStockItems([...outOfStockItems, item.product.id]);
                          }
                        }}
                        className={`flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${outOfStockItems.includes(item.product.id) ? 'border-red-500 bg-red-50' : 'border-gray-100'}`}
                      >
                        <img src={item.product.image} className="w-12 h-12 rounded-xl object-cover" />
                        <div className="flex-grow">
                          <p className="text-sm font-bold text-gray-800 line-clamp-1">{item.product.name}</p>
                          <p className="text-xs text-gray-400 font-bold">Số lượng: {item.quantity}</p>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${outOfStockItems.includes(item.product.id) ? 'bg-red-500 border-red-500' : 'border-gray-200'}`}>
                          {outOfStockItems.includes(item.product.id) && <Check className="w-4 h-4 text-white" />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button onClick={() => setCancelStep('reason')} className="flex-1 py-4 rounded-2xl bg-gray-100 text-gray-500 font-black">Quay lại</button>
                    <button 
                      disabled={outOfStockItems.length === 0}
                      onClick={handleCancelOrder} 
                      className="flex-1 py-4 rounded-2xl bg-red-500 text-white font-black shadow-lg shadow-red-200 disabled:opacity-50"
                    >
                      Xác nhận hủy
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Admin Password Modal */}
      <AnimatePresence>
        {showAdminPasswordModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAdminPasswordModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-md rounded-[3rem] shadow-2xl p-10"
            >
              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-primary-light/20 rounded-full flex items-center justify-center mx-auto text-primary-dark">
                  <User className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900">Xác thực Admin 🐾</h3>
                  <p className="text-gray-400 font-bold mt-2">Vui lòng nhập mật khẩu để vào trang quản trị</p>
                </div>
                <div className="space-y-4">
                  <input 
                    type="password"
                    placeholder="Nhập mật khẩu..."
                    value={adminPasswordInput}
                    onChange={e => setAdminPasswordInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdminAccess()}
                    className="w-full px-8 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-primary-light outline-none font-bold text-center"
                  />
                  {adminPasswordError && <p className="text-red-500 text-xs font-bold">{adminPasswordError}</p>}
                </div>
                <div className="flex gap-4 pt-4">
                  <button onClick={() => setShowAdminPasswordModal(false)} className="flex-1 py-4 rounded-2xl bg-gray-100 text-gray-500 font-black">Hủy</button>
                  <button onClick={handleAdminAccess} className="flex-1 py-4 rounded-2xl bg-primary-dark text-white font-black shadow-lg">Xác nhận</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="bg-white pt-24 pb-12 border-t-8 border-primary-light/20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16 mb-20">
            <div className="space-y-8">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg overflow-hidden border-2 border-primary-light">
                  <img 
                    src={cleanImageUrl(settings.logo)} 
                    alt="HanaChiBi Logo" 
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://picsum.photos/seed/hanachibi-logo/200/200";
                    }}
                  />
                </div>
                <h2 className="text-2xl font-black text-primary-dark">HanaChiBi</h2>
              </div>
              <p className="text-gray-400 font-medium leading-relaxed">
                HanaChiBi - Nơi hội tụ những món đồ dùng học tập xinh xắn nhất, giúp bạn tự tin tỏa sáng trên con đường tri thức.
              </p>
              <div className="flex gap-4">
                {[Facebook, Instagram].map((Icon, i) => (
                  <a key={i} href="#" className="w-12 h-12 rounded-2xl bg-primary-light/20 flex items-center justify-center text-primary-dark hover:bg-primary hover:text-white transition-all shadow-sm">
                    <Icon className="w-5 h-5" />
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-black text-gray-900 mb-8 uppercase text-xs tracking-[0.2em]">Khám phá</h4>
              <ul className="space-y-4">
                {["Sản phẩm mới", "Bán chạy nhất", "Combo tiết kiệm", "Quà tặng xinh"].map(item => (
                  <li key={item}><a href="#" className="text-gray-500 font-bold hover:text-primary transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-black text-gray-900 mb-8 uppercase text-xs tracking-[0.2em]">Hỗ trợ</h4>
              <ul className="space-y-4">
                {["Chính sách đổi trả", "Phí vận chuyển", "Hướng dẫn chọn quà", "Liên hệ hỗ trợ"].map(item => (
                  <li key={item}><a href="#" className="text-gray-500 font-bold hover:text-primary transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-black text-gray-900 mb-8 uppercase text-xs tracking-[0.2em]">Liên hệ</h4>
              <ul className="space-y-5">
                <li className="flex items-start gap-4 text-gray-500 font-medium">
                  <MapPin className="w-5 h-5 text-primary shrink-0" />
                  <span>Trường Đại học Hải Phòng, quận Kiến An</span>
                </li>
                <li className="flex items-center gap-4 text-gray-500 font-medium">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <span>039 6265 421</span>
                </li>
                <li className="flex items-center gap-4 text-gray-500 font-medium">
                  <Mail className="w-5 h-5 text-primary shrink-0" />
                  <span>hello@hanachibi.vn</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-12 border-t border-gray-100 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">© 2026 HanaChiBi Stationery. Made with 💖</p>
            <div className="flex gap-8 items-center grayscale opacity-40">
              <img src="https://upload.wikimedia.org/wikipedia/commons/5/5e/Visa_Inc._logo.svg" alt="Visa" className="h-4" />
              <img src="https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" alt="Mastercard" className="h-5" />
            </div>
          </div>
        </div>
      </footer>

      {/* Custom Alert Modal */}
      <AnimatePresence>
        {customAlert && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setCustomAlert(null)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white rounded-[2rem] shadow-2xl p-8 max-w-sm w-full text-center"
            >
              <div className={`w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center ${
                customAlert.type === 'success' ? 'bg-green-100 text-green-500' : 
                customAlert.type === 'error' ? 'bg-red-100 text-red-500' : 'bg-blue-100 text-blue-500'
              }`}>
                {customAlert.type === 'success' ? <Check className="w-8 h-8" /> : 
                 customAlert.type === 'error' ? <X className="w-8 h-8" /> : <Sparkles className="w-8 h-8" />}
              </div>
              <p className="text-gray-900 font-black text-lg mb-8">{customAlert.message}</p>
              <button
                onClick={() => setCustomAlert(null)}
                className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-gray-800 transition-all"
              >
                Đóng
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirm Modal */}
      <AnimatePresence>
        {customConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setCustomConfirm(null)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white rounded-[2rem] shadow-2xl p-8 max-w-sm w-full text-center"
            >
              <div className="w-16 h-16 bg-yellow-100 text-yellow-500 rounded-full mx-auto mb-6 flex items-center justify-center">
                <Sparkles className="w-8 h-8" />
              </div>
              <p className="text-gray-900 font-black text-lg mb-8">{customConfirm.message}</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setCustomConfirm(null)}
                  className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                >
                  Hủy
                </button>
                <button
                  onClick={() => {
                    customConfirm.onConfirm();
                    setCustomConfirm(null);
                  }}
                  className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-200"
                >
                  Xác nhận
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
