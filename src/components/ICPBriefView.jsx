// Module 5: ICP Brief Generation - ICPBriefView Component

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import jsPDF from 'jspdf';

export default function ICPBriefView() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadBrief();
  }, []);

  const loadBrief = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError('No authenticated user');
      setLoading(false);
      return;
    }

    try {
      // Load brief from Firestore
      const briefPath = getPath.userICPBrief(user.uid);
      const briefRef = doc(db, briefPath);
      const briefDoc = await getDoc(briefRef);

      if (briefDoc.exists()) {
        setBrief(briefDoc.data());
      } else {
        setError('No ICP brief found. Please complete the ICP Builder first.');
      }
    } catch (err) {
      console.error('Error loading brief:', err);
      setError('Failed to load ICP brief');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = () => {
    if (!brief) return;

    // Create new PDF document
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Set font
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Ideal Customer Profile Brief', 20, 20);

    // Add generation date
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    const date = new Date(brief.generatedAt).toLocaleDateString();
    pdf.text(`Generated: ${date}`, 20, 30);

    // Add brief text with word wrapping
    pdf.setFontSize(11);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margins = 20;
    const textWidth = pageWidth - (margins * 2);

    // Split text into lines
    const lines = pdf.splitTextToSize(brief.text, textWidth);

    // Add text with pagination
    let y = 40;
    const lineHeight = 7;
    const pageHeight = pdf.internal.pageSize.getHeight();

    lines.forEach((line) => {
      if (y + lineHeight > pageHeight - 20) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(line, margins, y);
      y += lineHeight;
    });

    // Save the PDF
    pdf.save('icp-brief.pdf');
  };

  const handleMatchCompanies = () => {
    navigate('/companies');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-cyan-400 text-xl mb-4">Loading your ICP brief...</div>
          <div className="animate-pulse text-gray-400">Please wait</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-400 text-xl mb-4">Error</div>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => navigate('/icp')}
            className="px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
          >
            Go to ICP Builder
          </button>
        </div>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400">No brief available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-cyan-400 mb-2">Your ICP Brief</h1>
          <p className="text-gray-400">
            Generated on {new Date(brief.generatedAt).toLocaleDateString()}
          </p>
        </div>

        {/* Brief Content */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-8 mb-8">
          <div className="whitespace-pre-wrap text-gray-200 leading-relaxed">
            {brief.text}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4 justify-center">
          <button
            onClick={handleDownloadPDF}
            className="px-8 py-4 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download PDF
          </button>

          <button
            onClick={handleMatchCompanies}
            className="px-8 py-4 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors font-bold"
          >
            Match Companies to Your ICP
          </button>
        </div>
      </div>
    </div>
  );
}
