import os, tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from recognition.recognizer import get_recognizer
from recognition.drug_correction import load_drug_dictionary, parse_prescription_text
app=Flask(__name__); CORS(app)
BASE=os.path.dirname(os.path.abspath(__file__))
recognizer=get_recognizer('baseline',tesseract_cmd=os.environ.get('TESSERACT_CMD'))
@app.get('/health')
def health(): return jsonify({'status':'ok','service':'prescription OCR'})
@app.post('/recognize')
def recognize():
 f=request.files.get('file')
 if not f:return jsonify({'detail':'Upload a file field named file'}),400
 suffix=os.path.splitext(f.filename or 'image.png')[1] or '.png'
 with tempfile.NamedTemporaryFile(delete=False,suffix=suffix) as tmp: f.save(tmp.name); path=tmp.name
 try:
  raw=recognizer.recognize(path); dictionary=load_drug_dictionary(os.path.join(BASE,'data','drug_dictionary.csv')); items=parse_prescription_text(raw,dictionary)
  return jsonify({'raw_text':raw,'items':[{'raw_text':i.raw_text,'drug_name':i.drug_name,'dosage':i.dosage,'frequency':i.frequency,'duration':i.duration,'confidence':i.confidence} for i in items]})
 except Exception as e:return jsonify({'detail':str(e),'hint':'Check Tesseract installation and TESSERACT_CMD.'}),500
 finally:
  try:os.remove(path)
  except OSError:pass
if __name__=='__main__':app.run(host='127.0.0.1',port=int(os.environ.get('AI_PORT',8000)),debug=False)
