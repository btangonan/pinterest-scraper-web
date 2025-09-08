'use client';

import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { PinterestImage } from '@/lib/scraper';

export default function Home() {
  const [boardUrl, setBoardUrl] = useState('');
  const [images, setImages] = useState<PinterestImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [imageSize, setImageSize] = useState<'medium' | 'large' | 'original'>('large');

  const handleScrape = async () => {
    if (!boardUrl) return;
    
    setLoading(true);
    setError('');
    setSuccessMsg('');
    setImages([]);
    setSelectedImages(new Set());
    
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardUrl })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to scrape board');
      }
      
      setImages(data.images);
      // Auto-select all images initially
      setSelectedImages(new Set(data.images.map((img: PinterestImage) => img.id)));
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const toggleImageSelection = (imageId: string) => {
    const newSelection = new Set(selectedImages);
    if (newSelection.has(imageId)) {
      newSelection.delete(imageId);
    } else {
      newSelection.add(imageId);
    }
    setSelectedImages(newSelection);
  };

  const selectAll = () => {
    setSelectedImages(new Set(images.map(img => img.id)));
  };

  const deselectAll = () => {
    setSelectedImages(new Set());
  };

  const downloadSelected = async () => {
    const selectedImagesList = images.filter(img => selectedImages.has(img.id));
    
    if (selectedImagesList.length === 0) {
      alert('Please select at least one image');
      return;
    }
    
    setDownloading(true);
    setError('');
    setSuccessMsg('');
    
    try {
      const zip = new JSZip();
      const folder = zip.folder('pinterest-images');
      
      // Helper function to download with retry
      const downloadWithRetry = async (image: PinterestImage, index: number, maxRetries = 3) => {
        const imageUrl = image[imageSize];
        if (!imageUrl) return null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const proxyUrl = `/api/download?url=${encodeURIComponent(imageUrl)}`;
            const response = await fetch(proxyUrl);
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const blob = await response.blob();
            
            // Verify we got an image
            if (blob.size === 0 || !blob.type.startsWith('image/')) {
              throw new Error('Invalid image data received');
            }
            
            const filename = `${String(index + 1).padStart(3, '0')}_pinterest_${image.id}.jpg`;
            return { filename, blob };
            
          } catch (error) {
            console.warn(`Download attempt ${attempt}/${maxRetries} failed for image ${image.id}:`, error);
            
            if (attempt === maxRetries) {
              console.error(`Failed to download image ${image.id} after ${maxRetries} attempts`);
              return null;
            }
            
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          }
        }
      };
      
      // Download all selected images with retry logic
      const downloadPromises = selectedImagesList.map(async (image, index) => {
        const result = await downloadWithRetry(image, index);
        if (result) {
          folder?.file(result.filename, result.blob);
        }
        return result;
      });
      
      const results = await Promise.all(downloadPromises);
      
      // Count successful downloads
      const successfulDownloads = results.filter(result => result !== null).length;
      const failedDownloads = results.length - successfulDownloads;
      
      // Generate and download ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const timestamp = new Date().toISOString().slice(0, 10);
      saveAs(zipBlob, `pinterest-board-${timestamp}.zip`);
      
      if (failedDownloads > 0) {
        setSuccessMsg(`✅ Downloaded ${successfulDownloads} images (${failedDownloads} failed)`);
      } else {
        setSuccessMsg(`✅ Successfully downloaded all ${successfulDownloads} images!`);
      }
    } catch (error) {
      setError('Failed to create ZIP file');
      console.error('ZIP creation error:', error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-black mb-2">
            Pinterest Board Scraper
          </h1>
          <p className="text-gray-800 font-medium">
            Download high-resolution images from any public Pinterest board - no login required!
          </p>
        </div>

        {/* URL Input */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex gap-4">
            <input
              type="url"
              value={boardUrl}
              onChange={(e) => setBoardUrl(e.target.value)}
              placeholder="https://www.pinterest.com/username/board-name/"
              className="flex-1 px-4 py-2 border border-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black placeholder-gray-500 bg-white"
              disabled={loading}
            />
            <button
              onClick={handleScrape}
              disabled={loading || !boardUrl}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Scraping...' : 'Scrape Board'}
            </button>
          </div>
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 font-medium">
              {error}
            </div>
          )}
          
          {successMsg && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 font-medium">
              {successMsg}
            </div>
          )}
        </div>

        {/* Results */}
        {images.length > 0 && (
          <>
            {/* Controls */}
            <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-black font-semibold">
                  {selectedImages.size} of {images.length} images selected
                </span>
                <button
                  onClick={selectAll}
                  className="text-blue-600 hover:text-blue-800 font-medium underline"
                >
                  Select All
                </button>
                <button
                  onClick={deselectAll}
                  className="text-blue-600 hover:text-blue-800 font-medium underline"
                >
                  Deselect All
                </button>
              </div>
              
              <div className="flex items-center gap-4">
                <select
                  value={imageSize}
                  onChange={(e) => setImageSize(e.target.value as any)}
                  className="px-3 py-2 border border-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                >
                  <option value="medium">Medium (474px)</option>
                  <option value="large">Large (736px)</option>
                  <option value="original">Original (Full Size)</option>
                </select>
                
                <button
                  onClick={downloadSelected}
                  disabled={selectedImages.size === 0 || downloading}
                  className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {downloading ? '⏳ Creating ZIP...' : `📦 Download as ZIP (${selectedImages.size})`}
                </button>
              </div>
            </div>

            {/* Image Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {images.map((image) => (
                <div
                  key={image.id}
                  className={`relative group cursor-pointer rounded-lg overflow-hidden shadow-md transition-all ${
                    selectedImages.has(image.id) 
                      ? 'ring-4 ring-blue-500 scale-95' 
                      : 'hover:scale-105'
                  }`}
                  onClick={() => toggleImageSelection(image.id)}
                >
                  <img
                    src={image.thumbnail}
                    alt={image.title || 'Pinterest Image'}
                    className="w-full h-auto bg-gray-100"
                    loading="lazy"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      // Multiple fallback attempts
                      const target = e.target as HTMLImageElement;
                      const currentSrc = target.src;
                      
                      if (currentSrc === image.thumbnail) {
                        // Try proxy if direct URL failed
                        target.src = `/api/download?url=${encodeURIComponent(image.thumbnail)}`;
                      } else if (currentSrc.includes('/api/download')) {
                        // Try different size if proxy failed
                        target.src = image.medium;
                      } else {
                        // Last resort: try original
                        target.src = image.original;
                      }
                      
                      // Add error styling
                      target.style.backgroundColor = '#f3f4f6';
                      target.style.border = '2px dashed #d1d5db';
                    }}
                  />
                  
                  {/* Selection Overlay */}
                  <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                    selectedImages.has(image.id)
                      ? 'bg-blue-500 bg-opacity-30'
                      : 'bg-black bg-opacity-0 group-hover:bg-opacity-20'
                  }`}>
                    {selectedImages.has(image.id) && (
                      <svg className="w-12 h-12 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  
                  {/* Image Info */}
                  {image.title && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-2">
                      <p className="text-white text-xs truncate font-medium">{image.title}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-800 font-medium">Scraping Pinterest board...</p>
          </div>
        )}
        
        {/* Example */}
        {!loading && images.length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-black mb-2">How it works:</h2>
            <ol className="list-decimal list-inside space-y-2 text-gray-900">
              <li>Paste a Pinterest board URL (e.g., https://www.pinterest.com/btangonan/droopreel-design/)</li>
              <li>Click "Scrape Board" to fetch all images</li>
              <li>Select the images you want to download</li>
              <li>Choose your preferred resolution</li>
              <li>Click "Download as ZIP" to save them all at once</li>
            </ol>
            
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-900 font-medium">
                <strong>Try it with your board:</strong> https://www.pinterest.com/btangonan/droopreel-design/
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}