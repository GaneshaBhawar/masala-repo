
const jwt=require("jsonwebtoken");
const secret=process.env.JWT_SECRET||"dev-only-change-me";
function sign(email){return jwt.sign({email,role:"admin"},secret,{expiresIn:"8h"});}
function requireAdmin(req,res,next){
 try{const h=req.headers.authorization||""; if(!h.startsWith("Bearer ")) throw 0;
 req.admin=jwt.verify(h.slice(7),secret); next();}catch(e){return res.status(401).json({error:"Unauthorized"});}
}
module.exports={sign,requireAdmin};
