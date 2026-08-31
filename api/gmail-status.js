export default async function handler(req,res){
  const configured=Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GMAIL_REDIRECT_URI);
  res.status(200).json({configured,provider:"gmail",message:configured?"Gmail OAuth er klar til forbindelse.":"Gmail OAuth mangler Google Cloud-oplysninger."});
}