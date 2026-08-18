
const { db, admin } = require('../config/firebaseAdmin');
const fs = require('fs');
const path = require('path');

exports.exportCollection = async function(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const data = [];
  
  snapshot.forEach(doc => {
    data.push({ id: doc.id, ...doc.data() });
  });
  
  fs.writeFileSync(`${collectionName}.json`, JSON.stringify(data, null, 2));
}

exports.importCollection = async function(collectionName, inputDir = './exports', batchSize = 500, useAutoId = true) {
  try {
    const filePath = path.join(inputDir, `${collectionName}.json`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    console.log(`Importing collection: ${collectionName} from ${filePath}...`);
    console.log(`Using ${useAutoId ? 'auto-generated' : 'preserved'} IDs`);
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);
    
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`No data to import for ${collectionName}`);
      return 0;
    }
    
    let imported = 0;
    
    // Process in batches
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = db.batch();
      const chunk = data.slice(i, i + batchSize);
      
      chunk.forEach(item => {
        let docRef;
        const { id, ...docData } = item;
        
        if (useAutoId) {
          // Generate new auto ID
          docRef = db.collection(collectionName).doc();
        } else {
          // Preserve original ID or use random if not present
          docRef = db.collection(collectionName).doc(id || undefined);
        }
        
        // If the item had a 'data' wrapper (old export format), use it, otherwise use the item itself
        const dataToSave = item.data || docData;
        
        batch.set(docRef, dataToSave, { merge: false });
      });
      
      await batch.commit();
      imported += chunk.length;
      console.log(`  Imported ${imported}/${data.length} documents...`);
    }
    
    console.log(`✓ Successfully imported ${imported} documents to ${collectionName}`);
    return imported;
  } catch (error) {
    console.error(`Error importing collection ${collectionName}:`, error);
    throw error;
  }
}