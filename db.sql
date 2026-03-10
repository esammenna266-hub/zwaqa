-- ============================
-- 1. إنشاء قاعدة البيانات
-- ============================
CREATE DATABASE IF NOT EXISTS RestaurantDB;
USE RestaurantDB;

-- ============================
-- 2. إنشاء الجداول
-- ============================

-- جدول الفئات
CREATE TABLE MENU_CATEGORIES (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

-- جدول العملاء
CREATE TABLE CUSTOMER_PROFILES (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    delivery_address TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    preferred_payment_method VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول العناصر
CREATE TABLE MENU_ITEMS (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    ingredients TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url VARCHAR(500),
    is_available BOOLEAN DEFAULT TRUE,
    preparation_time_minutes INT DEFAULT 15,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES MENU_CATEGORIES(category_id)
);

-- جدول الطلبات (مطلوب لربط الجداول الأخرى)
CREATE TABLE ORDERS (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(10, 2),
    status VARCHAR(50) DEFAULT 'Pending',
    FOREIGN KEY (customer_id) REFERENCES CUSTOMER_PROFILES(customer_id)
);

-- جدول تفاصيل الطلب (لربط العناصر بالطلبات)
CREATE TABLE ORDER_DETAILS (
    order_detail_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    item_id INT,
    quantity INT DEFAULT 1,
    price_at_time DECIMAL(10, 2),
    FOREIGN KEY (order_id) REFERENCES ORDERS(order_id),
    FOREIGN KEY (item_id) REFERENCES MENU_ITEMS(item_id)
);

-- جدول سجل حالة الطلب
CREATE TABLE ORDER_STATUS_HISTORY (
    history_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    status VARCHAR(50) NOT NULL,
    staff_id INT,
    status_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES ORDERS(order_id)
);

-- جدول الموظفين
CREATE TABLE STAFF_PROFILES (
    staff_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    staff_role VARCHAR(100) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    current_assignment VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول المدفوعات
CREATE TABLE PAYMENTS (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    payment_method VARCHAR(50),
    payment_status VARCHAR(50) DEFAULT 'Pending',
    amount DECIMAL(10, 2) NOT NULL,
    transaction_id VARCHAR(255),
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_details TEXT,
    FOREIGN KEY (order_id) REFERENCES ORDERS(order_id)
);


-- ============================
-- 3. إدراج بيانات تجريبية
-- ============================

-- إضافة فئات
INSERT INTO MENU_CATEGORIES (category_name, description, display_order) VALUES
('مقبلات', 'أطباق خفيفة قبل الوجبة', 1),
('أطباق رئيسية', 'الأطباق الأساسية', 2),
('مشروبات', 'مشروبات باردة وساخنة', 3);

-- إضافة عملاء
INSERT INTO CUSTOMER_PROFILES (user_id, delivery_address, preferred_payment_method) VALUES
(101, 'القاهرة، مصر', 'كاش'),
(102, 'الإسكندرية، مصر', 'بطاقة ائتمان');

-- إضافة عناصر قائمة
INSERT INTO MENU_ITEMS (category_id, item_name, description, price, is_available) VALUES
(1, 'سلطة', 'سلطة طازجة مع خضروات', 25.00, TRUE),
(2, 'شيش طاووق', 'دجاج مشوي مع أرز', 75.00, TRUE),
(3, 'عصير برتقال', 'طازج 100%', 15.00, TRUE);

-- إضافة موظفين
INSERT INTO STAFF_PROFILES (user_id, staff_role, is_available) VALUES
(201, 'مدير', TRUE),
(202, 'مندوب توصيل', TRUE);

-- إضافة طلب
INSERT INTO ORDERS (customer_id, total_amount) VALUES
(1, 100.00);

-- إضافة تفاصيل الطلب
INSERT INTO ORDER_DETAILS (order_id, item_id, price_at_time) VALUES
(1, 1, 25.00),
(1, 2, 75.00);

-- إضافة سجل حالة الطلب
INSERT INTO ORDER_STATUS_HISTORY (order_id, status, staff_id, notes) VALUES
(1, 'قيد التحضير', 1, 'الطلب قيد التنفيذ');

-- إضافة دفعة
INSERT INTO PAYMENTS (order_id, payment_method, amount, payment_status) VALUES
(1, 'كاش', 100.00, 'مكتمل');

-- ============================
-- 4. استعلامات مثال
-- ============================

-- عرض جميع العناصر المتاحة
SELECT * FROM MENU_ITEMS WHERE is_available = TRUE;

-- عرض طلبات العميل 1
SELECT o.order_id, o.order_date, o.total_amount, o.status
FROM ORDERS o
WHERE o.customer_id = 1;

-- عرض سجل حالة طلب معين
SELECT osh.status, osh.status_time, sp.staff_role, osh.notes
FROM ORDER_STATUS_HISTORY osh
JOIN STAFF_PROFILES sp ON osh.staff_id = sp.staff_id
WHERE osh.order_id = 1;

-- عرض المدفوعات المعلقة
SELECT * FROM PAYMENTS WHERE payment_status = 'Pending';

-- عرض العناصر مع فئاتها
SELECT mi.item_name, mi.price, mc.category_name
FROM MENU_ITEMS mi
JOIN MENU_CATEGORIES mc ON mi.category_id = mc.category_id;

-- ============================
-- 5. فهارس لتحسين الأداء (اختياري)
-- ============================
CREATE INDEX idx_customer ON ORDERS(customer_id);
CREATE INDEX idx_order_status ON ORDER_STATUS_HISTORY(order_id);
CREATE INDEX idx_payment_order ON PAYMENTS(order_id);
CREATE INDEX idx_menu_category ON MENU_ITEMS(category_id);