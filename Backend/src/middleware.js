import jwt from 'jsonwebtoken';
export function auth(req,res,next){const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({message:'Please sign in to continue.'});try{req.user=jwt.verify(token,process.env.JWT_SECRET);next()}catch{return res.status(401).json({message:'Session expired. Please sign in again.'})}}
export function allow(...roles){return (req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({message:'You do not have permission for this action.'})}
