
require("dotenv").config();
const express=require("express"), path=require("path"), bcrypt=require("bcryptjs"), crypto=require("crypto");
const helmet=require("helmet"), compression=require("compression"), cors=require("cors");
const rateLimit=require("express-rate-limit"), Razorpay=require("razorpay");
const {db}=require("./db"), {sign,requireAdmin}=require("./auth");
const app=express(), PORT=process.env.PORT||3000;
const adminPasswordHash=bcrypt.hashSync(process.env.ADMIN_PASSWORD||"change-this-password",10);
app.use(helmet({contentSecurityPolicy:false}));
app.use(compression());
app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,"..","public"),{maxAge:"7d"}));

const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
app.get("/api/config",(req,res)=>res.json({storeName:process.env.STORE_NAME||"Masala House",phone:process.env.STORE_PHONE||"",email:process.env.STORE_EMAIL||"",freeShipping:Number(process.env.FREE_SHIPPING_THRESHOLD||499),razorpayEnabled:!!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)}));
app.get("/api/products",(req,res)=>{
 let {category,q,sort="featured",limit=100,offset=0}=req.query, params=[];
 let sql="SELECT id,name,slug,category,price,weight,image,rating FROM products WHERE active=1";
 if(category&&category!=="All"){sql+=" AND category=?";params.push(category)}
 if(q){sql+=" AND (name LIKE ? OR category LIKE ?)";params.push("%"+q+"%","%"+q+"%")}
 if(sort==="low")sql+=" ORDER BY price ASC"; else if(sort==="high")sql+=" ORDER BY price DESC"; else if(sort==="az")sql+=" ORDER BY name ASC"; else sql+=" ORDER BY id ASC";
 sql+=" LIMIT ? OFFSET ?";params.push(Math.min(Number(limit)||100,100),Math.max(Number(offset)||0,0));
 res.json(db.prepare(sql).all(...params));
});
app.get("/api/products/id/:id",(req,res)=>{const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);if(!p)return res.status(404).json({error:"Product not found"});res.json(p)});
app.get("/api/products/:slug",(req,res)=>{const p=db.prepare("SELECT * FROM products WHERE slug=? AND active=1").get(req.params.slug);if(!p)return res.status(404).json({error:"Product not found"});res.json(p)});

app.post("/api/orders",async(req,res)=>{
 const {name,email,phone,address,pincode,items,paymentMethod="cod"}=req.body||{};
 if(!name||!phone||!address||!pincode||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Missing checkout details"});
 const ids=items.map(x=>Number(x.productId)).filter(Boolean); const unique=[...new Set(ids)];
 const placeholders=unique.map(()=>"?").join(",");
 const rows=db.prepare(`SELECT * FROM products WHERE id IN (${placeholders}) AND active=1`).all(...unique);
 const map=new Map(rows.map(x=>[x.id,x])); let subtotal=0, normalized=[];
 for(const it of items){const p=map.get(Number(it.productId)),qty=Math.max(1,Math.min(99,Number(it.qty)||1));if(!p)return res.status(400).json({error:"Invalid product"});subtotal+=p.price*qty;normalized.push({p,qty});}
 const shipping=subtotal>=Number(process.env.FREE_SHIPPING_THRESHOLD||499)?0:49,total=subtotal+shipping;
 const orderNo="MH"+Date.now().toString(36).toUpperCase();
 let razorOrder=null;
 if(paymentMethod==="razorpay"){
   if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:"Online payment is not configured yet. Use Cash on Delivery or add Razorpay keys."});
   const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
   razorOrder=await rz.orders.create({amount:total*100,currency:"INR",receipt:orderNo});
 }
 const tx=db.transaction(()=>{
  const r=db.prepare(`INSERT INTO orders(order_no,customer_name,email,phone,address,pincode,subtotal,shipping,total,payment_method,razorpay_order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(orderNo,name,email||"",phone,address,pincode,subtotal,shipping,total,paymentMethod,razorOrder?.id||null);
  const ins=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,qty,price) VALUES(?,?,?,?,?)");
  normalized.forEach(x=>ins.run(r.lastInsertRowid,x.p.id,x.p.name,x.qty,x.p.price));
  return r.lastInsertRowid;
 });
 const id=tx();
 res.status(201).json({orderId:id,orderNo,total,shipping,razorpayOrderId:razorOrder?.id||null,keyId:process.env.RAZORPAY_KEY_ID||null});
});


app.post("/api/payments/verify",async(req,res)=>{
 const {orderNo,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body||{};
 if(!orderNo||!razorpay_order_id||!razorpay_payment_id||!razorpay_signature)return res.status(400).json({error:"Missing payment verification fields"});
 const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET||"").update(razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
 if(expected!==razorpay_signature)return res.status(400).json({error:"Invalid payment signature"});
 const order=db.prepare("SELECT * FROM orders WHERE order_no=? AND razorpay_order_id=?").get(orderNo,razorpay_order_id);
 if(!order)return res.status(404).json({error:"Order not found"});
 db.prepare("UPDATE orders SET payment_status='paid',order_status='confirmed' WHERE id=?").run(order.id);
 res.json({ok:true,orderNo});
});

app.post("/api/admin/login",async(req,res)=>{const {email,password}=req.body||{};if(!email||!password)return res.status(400).json({error:"Email and password required"});const ok=email===process.env.ADMIN_EMAIL&&await bcrypt.compare(password,adminPasswordHash);if(!ok)return res.status(401).json({error:"Invalid credentials"});res.json({token:sign(email)});});
app.get("/api/admin/orders",requireAdmin,(req,res)=>res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 200").all()));
app.patch("/api/admin/orders/:id",requireAdmin,(req,res)=>{const {status}=req.body||{};const allowed=["placed","confirmed","packed","shipped","delivered","cancelled"];if(!allowed.includes(status))return res.status(400).json({error:"Invalid status"});db.prepare("UPDATE orders SET order_status=? WHERE id=?").run(status,req.params.id);res.json({ok:true})});
app.get("/api/admin/products",requireAdmin,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id").all()));
app.post("/api/admin/products",requireAdmin,(req,res)=>{const {name,category,price,weight,image,rating=4.7}=req.body||{};if(!name||!category||!price||!weight||!image)return res.status(400).json({error:"Missing product fields"});try{const r=db.prepare("INSERT INTO products(name,slug,category,price,weight,image,rating) VALUES(?,?,?,?,?,?,?)").run(name,slugify(name),Number(price),weight,image,Number(rating));res.status(201).json({id:r.lastInsertRowid});}catch(e){res.status(400).json({error:"Product slug/name already exists"});}});
app.patch("/api/admin/products/:id",requireAdmin,(req,res)=>{const p=req.body||{};db.prepare("UPDATE products SET name=COALESCE(?,name),category=COALESCE(?,category),price=COALESCE(?,price),weight=COALESCE(?,weight),image=COALESCE(?,image),active=COALESCE(?,active) WHERE id=?").run(p.name||null,p.category||null,p.price==null?null:Number(p.price),p.weight||null,p.image||null,p.active==null?null:Number(p.active),req.params.id);res.json({ok:true})});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","public","index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error"});});
app.listen(PORT,()=>console.log(`Masala House running on http://localhost:${PORT}`));
