require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./config/database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// قاعدة بيانات MySQL
const mysql = require('mysql2');
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// اختبار اتصال قاعدة البيانات
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message);
        process.exit(1);
    }
    console.log('✅ تم الاتصال بقاعدة البيانات MySQL بنجاح');
    connection.release();
});

// WebSocket للتواصل في الوقت الحقيقي
io.on('connection', (socket) => {
    console.log('🔗 مستخدم جديد متصل:', socket.id);

    // انضمام إلى غرفة تتبع طلب
    socket.on('join-order-room', (orderId) => {
        socket.join(`order-${orderId}`);
        console.log(`📦 المستخدم ${socket.id} انضم إلى طلب ${orderId}`);
    });

    // تحديث حالة الطلب
    socket.on('order-status-update', (data) => {
        const { orderId, status, driverLocation } = data;
        io.to(`order-${orderId}`).emit('status-updated', {
            status,
            driverLocation,
            timestamp: new Date()
        });
    });

    // تحديث موقع السائق
    socket.on('driver-location-update', (data) => {
        const { orderId, location } = data;
        io.to(`order-${orderId}`).emit('driver-location-changed', location);
    });

    socket.on('disconnect', () => {
        console.log('👋 المستخدم انقطع:', socket.id);
    });
});

// ==================== مسارات API ====================

// 1. مسارات القائمة
app.get('/api/categories', async (req, res) => {
    try {
        const [categories] = await pool.promise().query(
            'SELECT * FROM MENU_CATEGORIES WHERE is_active = 1 ORDER BY display_order'
        );
        res.json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/categories/:id/items', async (req, res) => {
    try {
        const [items] = await pool.promise().query(
            `SELECT mi.*, mc.category_name 
             FROM MENU_ITEMS mi 
             LEFT JOIN MENU_CATEGORIES mc ON mi.category_id = mc.category_id 
             WHERE mi.category_id = ? AND mi.is_available = 1 
             ORDER BY mi.item_name`,
            [req.params.id]
        );
        res.json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/featured-items', async (req, res) => {
    try {
        const [items] = await pool.promise().query(
            `SELECT mi.*, mc.category_name 
             FROM MENU_ITEMS mi 
             LEFT JOIN MENU_CATEGORIES mc ON mi.category_id = mc.category_id 
             WHERE mi.is_available = 1 
             ORDER BY RAND() LIMIT 10`
        );
        res.json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. مسارات السلة
app.get('/api/cart/:customerId', async (req, res) => {
    try {
        const [cartItems] = await pool.promise().query(
            `SELECT ci.*, mi.item_name, mi.price, mi.image_url 
             FROM CART_ITEMS ci 
             JOIN MENU_ITEMS mi ON ci.item_id = mi.item_id 
             WHERE ci.customer_id = ? 
             ORDER BY ci.added_at DESC`,
            [req.params.customerId]
        );
        
        const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        res.json({ 
            success: true, 
            data: { items: cartItems, total: total.toFixed(2) } 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cart/add', async (req, res) => {
    const { customerId, itemId, quantity = 1 } = req.body;
    
    try {
        // التحقق من وجود العنصر في السلة
        const [existing] = await pool.promise().query(
            'SELECT * FROM CART_ITEMS WHERE customer_id = ? AND item_id = ?',
            [customerId, itemId]
        );
        
        if (existing.length > 0) {
            // تحديث الكمية
            await pool.promise().query(
                'UPDATE CART_ITEMS SET quantity = quantity + ? WHERE cart_item_id = ?',
                [quantity, existing[0].cart_item_id]
            );
        } else {
            // إضافة جديد
            await pool.promise().query(
                'INSERT INTO CART_ITEMS (customer_id, item_id, quantity) VALUES (?, ?, ?)',
                [customerId, itemId, quantity]
            );
        }
        
        res.json({ success: true, message: 'تمت إضافة المنتج إلى السلة' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/cart/remove/:cartItemId', async (req, res) => {
    try {
        await pool.promise().query(
            'DELETE FROM CART_ITEMS WHERE cart_item_id = ?',
            [req.params.cartItemId]
        );
        res.json({ success: true, message: 'تم حذف المنتج من السلة' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. مسارات الطلبات
app.post('/api/orders', async (req, res) => {
    const { customerId, items, totalAmount, deliveryAddress, paymentMethod } = req.body;
    
    const connection = await pool.promise().getConnection();
    
    try {
        await connection.beginTransaction();
        
        // إنشاء الطلب
        const [orderResult] = await connection.query(
            `INSERT INTO ORDERS (customer_id, total_amount, delivery_address, status) 
             VALUES (?, ?, ?, 'pending')`,
            [customerId, totalAmount, deliveryAddress]
        );
        
        const orderId = orderResult.insertId;
        
        // إضافة العناصر
        for (const item of items) {
            await connection.query(
                `INSERT INTO ORDER_ITEMS (order_id, item_id, quantity, price_at_time) 
                 VALUES (?, ?, ?, ?)`,
                [orderId, item.itemId, item.quantity, item.price]
            );
        }
        
        // سجل حالة الطلب
        await connection.query(
            `INSERT INTO ORDER_STATUS_HISTORY (order_id, status) 
             VALUES (?, 'pending')`,
            [orderId]
        );
        
        // إنشاء الدفع
        await connection.query(
            `INSERT INTO PAYMENTS (order_id, payment_method, amount, payment_status) 
             VALUES (?, ?, ?, 'pending')`,
            [orderId, paymentMethod, totalAmount]
        );
        
        // تفريغ السلة
        await connection.query(
            'DELETE FROM CART_ITEMS WHERE customer_id = ?',
            [customerId]
        );
        
        await connection.commit();
        
        // إشعار عبر WebSocket
        io.emit('new-order', { orderId, customerId });
        
        res.json({ 
            success: true, 
            message: 'تم إنشاء الطلب بنجاح',
            orderId: orderId
        });
        
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, error: error.message });
    } finally {
        connection.release();
    }
});

app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const [orders] = await pool.promise().query(
            `SELECT o.*, 
                    cp.delivery_address,
                    cp.preferred_payment_method,
                    JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'item_name', mi.item_name,
                            'quantity', oi.quantity,
                            'price', oi.price_at_time
                        )
                    ) as items
             FROM ORDERS o
             LEFT JOIN CUSTOMER_PROFILES cp ON o.customer_id = cp.customer_id
             LEFT JOIN ORDER_ITEMS oi ON o.order_id = oi.order_id
             LEFT JOIN MENU_ITEMS mi ON oi.item_id = mi.item_id
             WHERE o.order_id = ?
             GROUP BY o.order_id`,
            [req.params.orderId]
        );
        
        if (orders.length === 0) {
            return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
        }
        
        // جلب سجل الحالة
        const [statusHistory] = await pool.promise().query(
            `SELECT osh.*, sp.staff_role 
             FROM ORDER_STATUS_HISTORY osh
             LEFT JOIN STAFF_PROFILES sp ON osh.staff_id = sp.staff_id
             WHERE osh.order_id = ?
             ORDER BY osh.status_time DESC`,
            [req.params.orderId]
        );
        
        const orderData = {
            ...orders[0],
            statusHistory: statusHistory,
            items: JSON.parse(orders[0].items || '[]')
        };
        
        delete orderData.items; // إزالة الحقل المكرر
        
        res.json({ success: true, data: orderData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/customer/:customerId/orders', async (req, res) => {
    try {
        const [orders] = await pool.promise().query(
            `SELECT o.*, 
                    COUNT(oi.order_item_id) as items_count,
                    SUM(oi.quantity) as total_quantity
             FROM ORDERS o
             LEFT JOIN ORDER_ITEMS oi ON o.order_id = oi.order_id
             WHERE o.customer_id = ?
             GROUP BY o.order_id
             ORDER BY o.created_at DESC`,
            [req.params.customerId]
        );
        
        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. تتبع الطلب في الوقت الحقيقي
app.get('/api/orders/:orderId/tracking', async (req, res) => {
    try {
        const [order] = await pool.promise().query(
            `SELECT o.*, 
                    cp.delivery_address,
                    sp.staff_role as driver_role,
                    u.full_name as driver_name,
                    u.phone as driver_phone
             FROM ORDERS o
             LEFT JOIN CUSTOMER_PROFILES cp ON o.customer_id = cp.customer_id
             LEFT JOIN ORDER_STATUS_HISTORY osh ON o.order_id = osh.order_id 
                AND osh.status = 'on_the_way'
             LEFT JOIN STAFF_PROFILES sp ON osh.staff_id = sp.staff_id
             LEFT JOIN USERS u ON sp.user_id = u.user_id
             WHERE o.order_id = ?`,
            [req.params.orderId]
        );
        
        if (order.length === 0) {
            return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
        }
        
        const [statusHistory] = await pool.promise().query(
            `SELECT * FROM ORDER_STATUS_HISTORY 
             WHERE order_id = ? 
             ORDER BY status_time ASC`,
            [req.params.orderId]
        );
        
        // حساب الوقت المتوقع للتسليم
        const orderTime = new Date(order[0].created_at);
        const estimatedDelivery = new Date(orderTime);
        estimatedDelivery.setMinutes(orderTime.getMinutes() + 45); // افتراض 45 دقيقة
        
        const now = new Date();
        const etaMinutes = Math.max(0, Math.round((estimatedDelivery - now) / (1000 * 60)));
        
        res.json({
            success: true,
            data: {
                order: order[0],
                statusHistory: statusHistory,
                estimatedDelivery: etaMinutes,
                driverInfo: {
                    name: order[0].driver_name,
                    phone: order[0].driver_phone,
                    role: order[0].driver_role
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. مسارات المستخدمين
app.post('/api/auth/register', async (req, res) => {
    const { email, password, fullName, phone, address } = req.body;
    
    try {
        // التحقق من البريد الإلكتروني
        const [existing] = await pool.promise().query(
            'SELECT user_id FROM USERS WHERE email = ?',
            [email]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'البريد الإلكتروني موجود بالفعل' 
            });
        }
        
        // تشفير كلمة المرور
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        
        // إنشاء المستخدم
        const [userResult] = await pool.promise().query(
            `INSERT INTO USERS (email, password_hash, full_name, phone, user_type) 
             VALUES (?, ?, ?, ?, 'customer')`,
            [email, passwordHash, fullName, phone]
        );
        
        const userId = userResult.insertId;
        
        // إنشاء ملف العميل
        await pool.promise().query(
            `INSERT INTO CUSTOMER_PROFILES (user_id, delivery_address) 
             VALUES (?, ?)`,
            [userId, address]
        );
        
        // إنشاء توكن
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { userId: userId, email: email, userType: 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );
        
        res.json({
            success: true,
            message: 'تم إنشاء الحساب بنجاح',
            token: token,
            user: { userId, email, fullName, phone }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [users] = await pool.promise().query(
            'SELECT * FROM USERS WHERE email = ? AND is_active = 1',
            [email]
        );
        
        if (users.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' 
            });
        }
        
        const user = users[0];
        
        // التحقق من كلمة المرور
        const bcrypt = require('bcryptjs');
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' 
            });
        }
        
        // إنشاء توكن
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { 
                userId: user.user_id, 
                email: user.email, 
                userType: user.user_type 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );
        
        res.json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح',
            token: token,
            user: {
                userId: user.user_id,
                email: user.email,
                fullName: user.full_name,
                phone: user.phone,
                userType: user.user_type
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. مسارات لوحة التحكم (للموظفين)
app.get('/api/admin/orders', async (req, res) => {
    try {
        const [orders] = await pool.promise().query(
            `SELECT o.*, 
                    u.full_name as customer_name,
                    COUNT(oi.order_item_id) as items_count
             FROM ORDERS o
             LEFT JOIN CUSTOMER_PROFILES cp ON o.customer_id = cp.customer_id
             LEFT JOIN USERS u ON cp.user_id = u.user_id
             LEFT JOIN ORDER_ITEMS oi ON o.order_id = oi.order_id
             GROUP BY o.order_id
             ORDER BY o.created_at DESC`
        );
        
        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/orders/:orderId/status', async (req, res) => {
    const { status, staffId, notes } = req.body;
    
    try {
        await pool.promise().query('START TRANSACTION');
        
        // تحديث حالة الطلب
        await pool.promise().query(
            'UPDATE ORDERS SET status = ?, updated_at = NOW() WHERE order_id = ?',
            [status, req.params.orderId]
        );
        
        // إضافة إلى سجل الحالة
        await pool.promise().query(
            `INSERT INTO ORDER_STATUS_HISTORY (order_id, status, staff_id, notes) 
             VALUES (?, ?, ?, ?)`,
            [req.params.orderId, status, staffId, notes]
        );
        
        // إذا كانت الحالة "جاهز للتسليم"، تعيين سائق
        if (status === 'ready') {
            const [availableDrivers] = await pool.promise().query(
                `SELECT sp.staff_id 
                 FROM STAFF_PROFILES sp 
                 WHERE sp.staff_role = 'driver' AND sp.is_available = 1 
                 LIMIT 1`
            );
            
            if (availableDrivers.length > 0) {
                const driverId = availableDrivers[0].staff_id;
                
                // تحديث حالة السائق
                await pool.promise().query(
                    `UPDATE STAFF_PROFILES 
                     SET is_available = 0, current_assignment = ? 
                     WHERE staff_id = ?`,
                    [req.params.orderId, driverId]
                );
                
                // تحديث سجل حالة الطلب بالسائق
                await pool.promise().query(
                    `INSERT INTO ORDER_STATUS_HISTORY (order_id, status, staff_id) 
                     VALUES (?, 'assigned_to_driver', ?)`,
                    [req.params.orderId, driverId]
                );
            }
        }
        
        await pool.promise().query('COMMIT');
        
        // إرسال تحديث عبر WebSocket
        io.emit('order-status-changed', {
            orderId: req.params.orderId,
            status: status,
            timestamp: new Date()
        });
        
        res.json({ success: true, message: 'تم تحديث حالة الطلب' });
        
    } catch (error) {
        await pool.promise().query('ROLLBACK');
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. مسارات البحث
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    
    try {
        const [results] = await pool.promise().query(
            `SELECT mi.*, mc.category_name 
             FROM MENU_ITEMS mi 
             LEFT JOIN MENU_CATEGORIES mc ON mi.category_id = mc.category_id 
             WHERE mi.is_available = 1 
               AND (mi.item_name LIKE ? OR mi.description LIKE ? OR mc.category_name LIKE ?)
             ORDER BY mi.item_name`,
            [`%${q}%`, `%${q}%`, `%${q}%`]
        );
        
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// مسار الصحة
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date(),
        database: 'connected',
        websocket: io.engine.clientsCount
    });
});

// التعامل مع الأخطاء
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'المسار غير موجود' });
});

app.use((error, req, res, next) => {
    console.error('🔥 خطأ في الخادم:', error);
    res.status(500).json({ 
        success: false, 
        error: 'حدث خطأ داخلي في الخادم',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
    console.log(`🔗 WebSocket جاهز على ws://localhost:${PORT}`);
});
// مثال: جلب الفئات
fetch('http://localhost:3000/api/categories')
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      // عرض الفئات
      console.log(data.data);
    }
  });

// مثال: WebSocket
const socket = io('http://localhost:3000');
socket.emit('join-order-room', '123');
socket.on('status-updated', (data) => {
  console.log('تحديث حالة:', data);
});